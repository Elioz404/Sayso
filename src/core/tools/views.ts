// How core objects read to an agent: plain JSON with formatted amounts, a status in words, and what to
// do next. Buyer views never carry internal ids or anything about other buyers.

import { actionAmount } from '../guard/describe.ts';
import type { Catalog } from '../catalog.ts';
import type { Links } from '../links.ts';
import type { PayPalCart } from '../cart/spec.ts';
import type { GuardRecord, RecordStatus } from '../guard/types.ts';
import { DEFAULT_CURRENCY, formatMoney } from '../money.ts';
import { PAYMENT_FOR_BUYER } from '../order-words.ts';
import type { PriceReference } from '../market.ts';
import { searchCatalog, type ProductQuery } from '../search.ts';
import type { ToolContext } from './context.ts';

/** Plain catalog view for agents: what's for sale, at what price, how many. */
export function catalogView(catalog: Catalog) {
  const { shop } = catalog;
  return {
    shop: { slug: shop.slug, name: shop.name, currency: shop.currency, ships_from: shop.country, status: shop.status ?? 'live' },
    products: catalog.products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      variants: p.variants.map((v) => ({
        variant_id: v.id,
        title: v.title,
        price: formatMoney(v.price, shop.currency),
        in_stock: v.madeToOrderDays !== undefined ? 'made to order' : v.inventory,
      })),
    })),
    shipping: shop.shipping.map((s) => ({ name: s.name, to: s.countries.join(', '), price: formatMoney(s.price, shop.currency), days: `${s.minDays}-${s.maxDays}` })),
  };
}

/** A market price reference with amounts written out, for agents and the owner's grid. */
export function priceReferenceView(ref: PriceReference) {
  const money = (minor?: number) => (minor === undefined ? undefined : formatMoney(minor, ref.currency));
  return {
    searched_for: ref.query,
    listings: ref.listings,
    usual_range: ref.low === undefined ? undefined : `${money(ref.low)} - ${money(ref.high)}`,
    median: money(ref.median),
    your_price_is: ref.position,
    summary: ref.summary,
    examples: ref.examples,
  };
}

/** What one shop offers for a search: matching products (with their page and photo, to show the buyer), shipping and returns. */
export function shopOffer(catalog: Catalog, query: ProductQuery, links: Pick<Links, 'productPage' | 'asset'>) {
  const view = catalogView(catalog);
  const photos = new Map(catalog.products.map((p) => [p.id, p.imageUrl]));
  const products = searchCatalog(catalog, query).map((p) => {
    const photo = photos.get(p.id);
    return { ...p, url: links.productPage(catalog.shop.slug, p.id), ...(photo ? { image: links.asset(photo) } : {}) };
  });
  return { shop: view.shop, products, shipping: view.shipping, returns: `${catalog.shop.returnPolicy.days} days` };
}

export function cartForAgent(cart: PayPalCart) {
  const next =
    cart.status === 'COMPLETED'
      ? "Order placed. For a problem with it, use request_refund with the buyer's reason."
      : cart.payment_method?.approval_url
        ? "Ready to pay. Apps that show Sayso's cart card already give the buyer this cart with a Pay with PayPal button below it: then answer in one short sentence and don't repeat the items, totals or link. Otherwise send the buyer to approval_url. The order completes when they approve."
        : 'Fix the validation_issues (apply a resolution option with update_cart), then the cart gets an approval_url.';
  return {
    cart_id: cart.id,
    status: cart.status,
    validation_status: cart.validation_status,
    validation_issues: cart.validation_issues,
    items: cart.items,
    totals: cart.totals,
    shipping_options: cart.available_shipping_options,
    approval_url: cart.payment_method?.approval_url,
    next,
  };
}

/** What a buyer's assistant may know about a paid order. */
export async function orderForBuyer(ctx: ToolContext, shopId: string, cartId: string) {
  const { order, records } = await ctx.services.orders.get(shopId, cartId);
  return {
    number: order.number,
    payment: PAYMENT_FOR_BUYER[order.status] ?? order.status,
    refunded: order.refunded ?? 'nothing',
    tracking: order.tracking ? { carrier: order.tracking.carrier, number: order.tracking.number } : 'not shipped yet',
    refund_requests: records.filter((r) => r.action.kind === 'refund.create' && r.action.actor.side === 'buyer').map(refundRequestForBuyer),
  };
}

const REFUND_FOR_BUYER: Partial<Record<RecordStatus, string>> = {
  pending_approval: 'waiting for the shop owner',
  verified: 'refunded through PayPal',
  unverified: 'refund sent to PayPal, confirmation pending',
  executed: 'refund sent to PayPal',
  rejected: 'declined by the shop owner',
  denied: 'not possible',
  failed: 'PayPal could not complete it',
};

export function refundRequestForBuyer(record: GuardRecord) {
  return {
    request_id: record.id,
    amount: record.action.amount !== undefined ? formatMoney(record.action.amount, record.action.currency ?? DEFAULT_CURRENCY) : 'everything still refundable',
    reason: record.action.reason,
    status: REFUND_FOR_BUYER[record.status] ?? record.status,
    ...(record.status === 'denied' ? { why: record.decision?.hits.filter((h) => h.ruleId === 'simulation').map((h) => h.message) } : {}),
    asked_at: record.createdAt,
  };
}

/** How a Guard record reads to an agent: what happened, why, and what to tell the owner. */
export function sayso(record: GuardRecord, ctx: ToolContext) {
  const next: Record<RecordStatus, string> = {
    pending_approval: `Waiting for the owner. Tell them what you asked for and why; they approve or reject at ${ctx.services.links.approve(record.id)}. You cannot approve it. Check back with get_say_so.`,
    verified: record.action.kind === 'policy.update' ? 'Done: the new rules apply from now on.' : 'Done and confirmed with PayPal.',
    unverified: 'PayPal accepted it but the confirmation read-back failed. Treat it as done; the owner can check it in PayPal. Do not retry.',
    executed: 'Sent to PayPal; confirmation pending.',
    denied: record.decision?.hits.some((h) => h.ruleId === 'simulation')
      ? 'Blocked before reaching PayPal: it would fail against the live payment state. Nothing moved. Explain why to the owner; do not retry.'
      : "Refused by the owner's rules. Do not retry the same action; explain why to the owner.",
    rejected: 'The owner said no.',
    failed:
      record.action.kind === 'policy.update'
        ? 'Not applied: the rules changed after you proposed this. Read the current rules (get_policy) and propose again if it is still needed.'
        : 'PayPal did not complete it. Nothing else changed.',
    executing: 'In progress.',
  };
  return {
    say_so_id: record.id,
    action: record.action.kind,
    amount: actionAmount(record.action),
    status: record.status,
    what_happens: record.simulation?.effects ?? [],
    why: record.decision?.hits.map((h) => h.message) ?? [],
    next: next[record.status],
    at: record.createdAt,
  };
}
