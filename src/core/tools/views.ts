// How core objects read to an agent: plain JSON with formatted amounts, a status in words, and what to
// do next. Buyer views never carry internal ids or anything about other buyers.

import type { Catalog } from '../catalog.ts';
import type { PayPalCart } from '../cart/spec.ts';
import type { GuardRecord, RecordStatus } from '../guard/types.ts';
import { DEFAULT_CURRENCY, formatMoney } from '../money.ts';
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

export function cartForAgent(cart: PayPalCart) {
  const next =
    cart.status === 'COMPLETED'
      ? "Order placed. For a problem with it, use request_refund with the buyer's reason."
      : cart.payment_method?.approval_url
        ? 'Send the buyer to approval_url to pay with PayPal. The order completes when they approve.'
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

const PAYMENT_FOR_BUYER: Record<string, string> = {
  paid: 'Charged. The shop is preparing the order.',
  awaiting_owner: 'Authorized in PayPal. The shop confirms it before charging.',
  released: 'Cancelled by the shop. The buyer was not charged and the PayPal hold was released.',
};

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
  const currency = record.action.currency ?? DEFAULT_CURRENCY;
  const next: Record<RecordStatus, string> = {
    pending_approval: `Waiting for the owner. Tell them what you asked for and why; they approve or reject at ${ctx.services.links.approve(record.id)}. You cannot approve it. Check back with get_say_so.`,
    verified: record.action.kind === 'policy.update' ? 'Done: the new rules apply from now on.' : 'Done and confirmed with PayPal.',
    unverified: 'PayPal accepted it but the confirmation read-back failed. Treat it as done; the owner can check it in PayPal. Do not retry.',
    executed: 'Sent to PayPal; confirmation pending.',
    denied: record.decision?.hits.some((h) => h.ruleId === 'simulation')
      ? 'Blocked before reaching PayPal: it would fail against the live payment state. Nothing moved. Explain why to the owner; do not retry.'
      : "Refused by the owner's rules. Do not retry the same action; explain why to the owner.",
    rejected: 'The owner said no.',
    failed: 'PayPal did not complete it. Nothing else changed.',
    executing: 'In progress.',
  };
  return {
    say_so_id: record.id,
    action: record.action.kind,
    amount: record.action.amount !== undefined ? formatMoney(record.action.amount, currency) : undefined,
    status: record.status,
    what_happens: record.simulation?.effects ?? [],
    why: record.decision?.hits.map((h) => h.message) ?? [],
    next: next[record.status],
    at: record.createdAt,
  };
}
