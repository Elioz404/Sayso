// Pure cart pricing and validation for the merchant-cart API. Given the shop's catalog and the cart an
// agent sent, it returns the cart PayPal expects back: catalog prices, shipping options, tax, totals,
// and validation issues with resolution options an agent can apply on its own.
// No I/O here, so every rule is unit-tested (tests/cart.test.ts).

import { available, findVariant, type Catalog, type ShippingRule } from '../catalog.ts';
import { applyBps, formatMoney, toMinor, toMoney } from '../money.ts';
import type {
  CartItem,
  CartStatus,
  PayPalCart,
  ShippingOption,
  ValidationIssue,
  ValidationStatus,
} from './spec.ts';

export interface PriceCartOptions {
  /** POST creates (status CREATED when valid); PUT updates (status READY when valid). */
  mode: 'create' | 'update';
  now?: Date;
}

export function priceCart(catalog: Catalog, input: PayPalCart, options: PriceCartOptions): PayPalCart {
  const { shop } = catalog;
  const currency = shop.currency;
  const now = options.now ?? new Date();
  const issues: ValidationIssue[] = [];
  const items: CartItem[] = [];
  let subtotal = 0;
  const wanted = new Map<string, number>();

  if (!input.items?.length) {
    issues.push({
      code: 'DATA_ERROR',
      type: 'MISSING_FIELD',
      field: 'items',
      message: 'Cart has no items.',
      user_message: 'Add at least one product to the cart.',
    });
  }

  for (const item of input.items ?? []) {
    const found = item.variant_id ? findVariant(catalog, item.variant_id) : undefined;
    if (!found) {
      issues.push({
        code: 'DATA_ERROR',
        type: 'INVALID_DATA',
        variant_id: item.variant_id,
        field: 'items.variant_id',
        message: `Unknown variant "${item.variant_id ?? '(missing)'}" for shop ${shop.slug}.`,
        user_message: 'One of the items is no longer sold by this shop.',
        resolution_options: [{ action: 'REMOVE_ITEM', label: 'Remove this item', metadata: { auto_applicable: true } }],
      });
      continue;
    }

    const { product, variant } = found;
    const quantity = Math.max(1, Math.floor(item.quantity));

    // The catalog is the source of truth for price. If the agent quoted a stale price, say so.
    if (item.price && item.price.currency_code === currency && toMinor(item.price) !== variant.price) {
      issues.push({
        code: 'PRICING_ERROR',
        type: 'INVALID_DATA',
        variant_id: variant.id,
        field: 'items.price',
        message: `Price changed for ${product.name}: ${formatMoney(toMinor(item.price), currency)} -> ${formatMoney(variant.price, currency)}.`,
        user_message: `The price of ${product.name} is now ${formatMoney(variant.price, currency)}.`,
        context: { quoted: item.price, current: toMoney(variant.price, currency) },
        resolution_options: [
          { action: 'ACCEPT_NEW_PRICE', label: 'Accept the current price', metadata: { auto_applicable: false } },
          { action: 'REMOVE_ITEM', label: 'Remove this item' },
        ],
      });
    }

    // The same variant on several lines draws on one stock: judge the total asked for.
    const stock = available(variant);
    const requested = (wanted.get(variant.id) ?? 0) + quantity;
    wanted.set(variant.id, requested);
    if (requested > stock) {
      const alternatives = product.variants.filter((v) => v.id !== variant.id && available(v) >= quantity);
      const left = Math.max(0, stock - (requested - quantity));
      issues.push({
        code: 'INVENTORY_ISSUE',
        type: 'BUSINESS_RULE',
        variant_id: variant.id,
        message: `Only ${stock} of ${product.name} (${variant.title}) in stock, ${requested} requested.`,
        user_message: stock > 0 ? `Only ${stock} left of ${variant.title}.` : `${variant.title} is sold out.`,
        context: { requested, available: stock },
        resolution_options: [
          ...(left > 0
            ? [{ action: 'REDUCE_QUANTITY', label: `Buy ${left} instead`, metadata: { auto_applicable: true, quantity: left, priority: 1 } }]
            : []),
          ...alternatives.map((alt, i) => ({
            action: 'REPLACE_VARIANT',
            label: `Switch to ${alt.title}`,
            metadata: {
              priority: 2 + i,
              variant_id: alt.id,
              cost_impact: toMoney((alt.price - variant.price) * quantity, currency),
            },
          })),
          { action: 'REMOVE_ITEM', label: 'Remove this item', metadata: { priority: 99 } },
        ],
      });
    }

    // Totals reflect what was asked for; an INCOMPLETE cart can't be paid anyway (see isPayable).
    subtotal += variant.price * quantity;
    items.push({
      quantity,
      variant_id: variant.id,
      parent_id: product.id,
      name: `${product.name} - ${variant.title}`,
      description: product.description.slice(0, 120),
      price: toMoney(variant.price, currency),
      selected_attributes: Object.entries(variant.attributes).map(([name, value]) => ({ name, value })),
    });
  }

  // Shipping: only rules that serve the destination country are offered.
  const country = input.shipping_address?.country_code?.toUpperCase();
  let shippingOptions: ShippingOption[] = [];
  let shipping = 0;
  if (!country) {
    issues.push({
      code: 'SHIPPING_ERROR',
      type: 'MISSING_FIELD',
      field: 'shipping_address',
      message: 'A shipping address is required to quote shipping and tax.',
      user_message: 'Where should this be shipped?',
    });
  } else {
    const rules = shop.shipping.filter((r) => r.countries.includes('*') || r.countries.includes(country));
    if (rules.length === 0) {
      issues.push({
        code: 'SHIPPING_ERROR',
        type: 'BUSINESS_RULE',
        field: 'shipping_address.country_code',
        message: `${shop.name} does not ship to ${country}.`,
        user_message: `This shop does not ship to ${country} yet.`,
        context: { ships_to: [...new Set(shop.shipping.flatMap((r) => r.countries))] },
      });
    } else {
      const requested = input.available_shipping_options?.find((o) => o.is_selected)?.id;
      const priced = rules
        .map((rule) => ({ rule, price: shippingPrice(rule, subtotal) }))
        .sort((a, b) => a.price - b.price);
      const selectedId = priced.some((p) => p.rule.id === requested) ? requested : priced[0].rule.id;
      shippingOptions = priced.map(({ rule, price }) => ({
        id: rule.id,
        name: rule.name,
        price: toMoney(price, currency),
        is_selected: rule.id === selectedId,
        description: `${rule.minDays}-${rule.maxDays} business days`,
        estimated_delivery: addDays(now, rule.maxDays),
      }));
      shipping = priced.find((p) => p.rule.id === selectedId)!.price;
    }
  }

  const state = input.shipping_address?.admin_area_1?.toUpperCase();
  const taxBps = taxRate(shop.taxBps, country, state);
  const tax = applyBps(subtotal, taxBps);

  const validation_status: ValidationStatus = issues.length === 0
    ? 'VALID'
    : issues.every((i) => i.type === 'MISSING_FIELD')
      ? 'REQUIRES_ADDITIONAL_INFORMATION'
      : 'INVALID';
  const status: CartStatus = issues.length > 0 ? 'INCOMPLETE' : options.mode === 'create' ? 'CREATED' : 'READY';

  // Only what the buyer's side may set is carried over; everything else is computed here.
  return {
    customer: input.customer,
    shipping_address: input.shipping_address,
    billing_address: input.billing_address,
    status,
    validation_status,
    validation_issues: issues,
    items,
    available_shipping_options: shippingOptions,
    totals: {
      subtotal: toMoney(subtotal, currency),
      shipping: toMoney(shipping, currency),
      tax: toMoney(tax, currency),
      total: toMoney(subtotal + shipping + tax, currency),
    },
  };
}

/** A cart can be paid only when PayPal would get exactly what the shop can deliver. */
export function isPayable(cart: PayPalCart): boolean {
  return (cart.status === 'CREATED' || cart.status === 'READY') && (cart.validation_issues?.length ?? 0) === 0;
}

/** Most specific rate wins: "US-CA" over "US"; nothing configured means no tax. */
function taxRate(rates: Record<string, number>, country?: string, state?: string): number {
  if (country && state && rates[`${country}-${state}`] !== undefined) return rates[`${country}-${state}`];
  if (country && rates[country] !== undefined) return rates[country];
  return 0;
}

function shippingPrice(rule: ShippingRule, subtotal: number): number {
  return rule.freeAbove !== undefined && subtotal >= rule.freeAbove ? 0 : rule.price;
}

function addDays(from: Date, days: number): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
