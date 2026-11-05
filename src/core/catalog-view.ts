// The catalog as rows, one per variant: what the owner's grid shows and edits. Framework-free so the
// page, the API route and tests share it.

import { type Catalog, findVariant, pricesToConfirm, variantTitle } from './catalog.ts';
import { formatMoney, toMoney } from './money.ts';

export interface VariantRow {
  id: string;
  /** The product this option belongs to. */
  productId: string;
  product: string;
  /** The variant's own name, empty when the product has a single default variant. */
  title: string;
  currency: string;
  /** Minor units. */
  price: number;
  /** Units on hand; null for made-to-order variants, which have no stock limit. */
  stock: number | null;
  madeToOrderDays?: number;
  /** The price is a draft's suggestion the owner hasn't confirmed; the shop can't be published yet. */
  toConfirm: boolean;
  /** The product's photo (a path on this site or a full URL). */
  image?: string;
  /** Registered in PayPal's catalog (Catalog Products API). */
  inPayPal: boolean;
  /** Units sold in the last 14 days, when the page knows (the owner's catalog view adds it). */
  sold?: number;
}

export function variantRows(catalog: Catalog): VariantRow[] {
  return catalog.products.flatMap((p) => p.variants.map((v) => toRow(catalog, p.name, p.variants.length, v.id)!));
}

export function variantRow(catalog: Catalog, variantId: string): VariantRow | undefined {
  const found = findVariant(catalog, variantId);
  return found && toRow(catalog, found.product.name, found.product.variants.length, variantId);
}

function toRow(catalog: Catalog, product: string, siblings: number, variantId: string): VariantRow | undefined {
  const found = findVariant(catalog, variantId);
  const variant = found?.variant;
  if (!variant) return undefined;
  return {
    id: variant.id,
    productId: found.product.id,
    product,
    title: siblings > 1 || variantTitle(variant.title) ? variant.title : '',
    currency: catalog.shop.currency,
    price: variant.price,
    stock: variant.madeToOrderDays === undefined ? variant.inventory : null,
    madeToOrderDays: variant.madeToOrderDays,
    toConfirm: Boolean(variant.priceToConfirm),
    ...(found.product.imageUrl ? { image: found.product.imageUrl } : {}),
    inPayPal: Boolean(found.product.paypalProductId),
  };
}

/** Units of each variant sold since `since`, from the shop's orders (cancelled ones don't count). */
export function soldSince(orders: { status: string; number?: string; createdAt: string; items: { variant_id?: string; quantity: number }[] }[], since: Date): Map<string, number> {
  const sold = new Map<string, number>();
  for (const o of orders) {
    if (!o.number || o.status === 'released' || Date.parse(o.createdAt) < since.getTime()) continue;
    for (const i of o.items) if (i.variant_id) sold.set(i.variant_id, (sold.get(i.variant_id) ?? 0) + i.quantity);
  }
  return sold;
}

/** A draft shop as its owner reviews it before publishing: amounts as typed (decimal strings), a suggested price with the range it came from. */
export function draftView(catalog: Catalog) {
  const { shop } = catalog;
  const amount = (minor: number) => toMoney(minor, shop.currency).value;
  return {
    shop: { id: shop.id, slug: shop.slug, name: shop.name, currency: shop.currency, country: shop.country },
    products: catalog.products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      image: p.imageUrl,
      variants: p.variants.map((v) => ({
        id: v.id,
        title: v.title,
        price: v.price ? amount(v.price) : '',
        to_confirm: Boolean(v.priceToConfirm),
        ...(v.priceToConfirm?.suggested
          ? { suggested: { low: formatMoney(v.priceToConfirm.suggested.low, shop.currency), high: formatMoney(v.priceToConfirm.suggested.high, shop.currency), listings: v.priceToConfirm.suggested.listings } }
          : {}),
        stock: v.inventory,
        ...(v.madeToOrderDays !== undefined ? { made_to_order_days: v.madeToOrderDays } : {}),
      })),
    })),
    shipping: shop.shipping.map((r) => ({ id: r.id, name: r.name, countries: r.countries, price: amount(r.price), free_above: r.freeAbove ? amount(r.freeAbove) : '', days: `${r.minDays}-${r.maxDays}` })),
    to_confirm: pricesToConfirm(catalog).length,
  };
}

export type DraftView = ReturnType<typeof draftView>;
