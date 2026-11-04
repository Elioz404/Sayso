// What a buyer may see of their own orders, with no account: one order by its link (the cart id their
// browser or assistant already holds, the same key get_cart takes), or every order a PayPal account paid
// for, once the buyer signs in with that account. Their pieces, totals, where the order stands, tracking
// and refunds; never the owner's notes, other buyers or Sayso's internal records.

import { findVariant, type Catalog } from './catalog.ts';
import type { AuditEvent, GuardRecord } from './guard/types.ts';
import type { Links } from './links.ts';
import { formatMoney, toMinor, type Money } from './money.ts';
import type { Orders } from './orders.ts';
import { carrierName, trackingLink } from './shipping.ts';
import type { CartStore, CatalogStore, PayerRef, StoredCart } from './stores.ts';
import { PAYMENT_FOR_BUYER, refundRequestForBuyer } from './tools/views.ts';

export interface BuyerOrderDeps {
  carts: CartStore;
  catalogs: CatalogStore;
  orders: Orders;
  links: Links;
}

/** paid: charged, being prepared; waiting: authorized, the shop confirms before charging; refund-asked: the buyer's refund request waits for the owner. */
export type BuyerOrderState = 'paid' | 'waiting' | 'shipped' | 'refund-asked' | 'refunded' | 'cancelled';

export interface BuyerOrder {
  /** The order's link: /order/<id>. */
  id: string;
  number: string;
  shop: { name: string; url?: string };
  placedAt: string;
  state: BuyerOrderState;
  /** Where it stands, in one sentence. */
  status: string;
  /** What happened to the order, then what is still to come. `stop`: it ended there (cancelled, refund declined). */
  steps: { label: string; done: boolean; at?: string; stop?: boolean }[];
  items: { name: string; detail?: string; qty: number; amount?: string; image?: string; url?: string }[];
  subtotal?: string;
  shipping?: string;
  tax?: string;
  total?: string;
  refunded?: string;
  tracking?: { carrier: string; number: string; url?: string; at: string };
  refundRequests: { amount: string; status: string; reason?: string; askedAt: string }[];
  /** A refund can still be asked for: charged, not all refunded, and nothing already waiting with the owner. */
  canAskRefund: boolean;
  /** A refund the buyer asked for is waiting for the shop owner. */
  refundPending: boolean;
}

const show = (m?: Money) => (m ? formatMoney(toMinor(m), m.currency_code) : undefined);

/** One order by its link. Undefined for anything that isn't a placed order. */
export async function buyerOrder(deps: BuyerOrderDeps, cartId: string): Promise<BuyerOrder | undefined> {
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(cartId)) return undefined;
  const cart = await deps.carts.get(cartId);
  if (!cart || cart.cart.status !== 'COMPLETED' || !cart.merchantOrderNumber) return undefined;
  return view(deps, cart, await deps.catalogs.byShopId(cart.shopId));
}

/** Every order the PayPal account paid for, in every shop, newest first. */
export async function buyerOrders(deps: BuyerOrderDeps, payer: PayerRef): Promise<BuyerOrder[]> {
  const carts = await deps.carts.listByPayer(payer, 50);
  const catalogs = new Map<string, Promise<Catalog | undefined>>();
  const catalogOf = (shopId: string) => {
    if (!catalogs.has(shopId)) catalogs.set(shopId, deps.catalogs.byShopId(shopId));
    return catalogs.get(shopId)!;
  };
  return Promise.all(carts.map(async (c) => view(deps, c, await catalogOf(c.shopId))));
}

async function view(deps: BuyerOrderDeps, cart: StoredCart, catalog?: Catalog): Promise<BuyerOrder> {
  const { order, records } = await deps.orders.get(cart.shopId, cart.id);
  const totals = cart.cart.totals;
  const paid = Boolean(cart.captureId);
  const fullyRefunded = order.totalMinor !== undefined && order.refundedMinor >= order.totalMinor && order.refundedMinor > 0;
  const tracking = cart.tracking
    ? { carrier: carrierName(cart.tracking.carrier), number: cart.tracking.number, url: trackingLink(cart.tracking.carrier, cart.tracking.number), at: cart.tracking.addedAt }
    : undefined;

  const requests = records.filter((r) => r.action.kind === 'refund.create' && r.action.actor.side === 'buyer');
  const waitingRequest = requests.some((r) => r.status === 'pending_approval');
  const partly = order.refundedMinor > 0 && !fullyRefunded ? ` ${order.refunded} refunded through PayPal.` : '';

  const state: BuyerOrderState = cart.released
    ? 'cancelled'
    : !paid
      ? 'waiting'
      : fullyRefunded
        ? 'refunded'
        : waitingRequest
          ? 'refund-asked'
          : tracking
            ? 'shipped'
            : 'paid';
  const status = {
    cancelled: PAYMENT_FOR_BUYER.released,
    waiting: PAYMENT_FOR_BUYER.awaiting_owner,
    refunded: `Refunded in full (${order.refunded}) through PayPal.`,
    'refund-asked': `You asked for a refund. The shop owner decides; if they agree, PayPal refunds you.${partly}`,
    shipped: `Shipped with ${tracking?.carrier}.${partly}`,
    paid: `${PAYMENT_FOR_BUYER.paid}${partly}`,
  }[state];

  return {
    id: cart.id,
    number: cart.merchantOrderNumber!,
    shop: { name: catalog?.shop.name ?? 'The shop', ...(catalog ? { url: deps.links.shopPage(catalog.shop.slug) } : {}) },
    placedAt: cart.paidAt ?? cart.updatedAt,
    state,
    status,
    steps: progress(cart, records, { paid, fullyRefunded, waitingRequest, refundedMinor: order.refundedMinor }),
    items: cart.cart.items.map((i) => {
      const found = catalog && i.variant_id ? findVariant(catalog, i.variant_id) : undefined;
      const at = (i.name ?? '').lastIndexOf(' - ');
      return {
        name: at > 0 ? i.name!.slice(0, at) : (i.name ?? found?.product.name ?? 'Item'),
        ...(at > 0 ? { detail: i.name!.slice(at + 3) } : {}),
        qty: i.quantity,
        ...(i.price ? { amount: formatMoney(toMinor(i.price) * i.quantity, i.price.currency_code) } : {}),
        ...(found?.product.imageUrl ? { image: deps.links.asset(found.product.imageUrl) } : {}),
        ...(found && catalog ? { url: deps.links.productPage(catalog.shop.slug, found.product.id) } : {}),
      };
    }),
    subtotal: show(totals?.subtotal),
    shipping: show(totals?.shipping),
    tax: show(totals?.tax),
    total: show(totals?.total),
    ...(order.refundedMinor > 0 ? { refunded: order.refunded } : {}),
    ...(tracking ? { tracking } : {}),
    refundRequests: requests.map(refundRequestForBuyer).map((r) => ({ amount: r.amount, status: r.status, reason: r.reason, askedAt: r.asked_at })),
    canAskRefund: paid && !cart.released && !fullyRefunded && !waitingRequest,
    refundPending: waitingRequest,
  };
}

type Step = BuyerOrder['steps'][number];

const eventAt = (r: GuardRecord, type: AuditEvent['type']) => r.events.find((e) => e.type === type)?.at ?? r.createdAt;

/**
 * What happened to the order, in the order it happened, then what is still to come; the first step not
 * done is where it is now. Of the buyer's refund requests only the latest is a step (the others are listed
 * under Refunds), and refunds count once PayPal confirms them.
 */
function progress(cart: StoredCart, records: readonly GuardRecord[], o: { paid: boolean; fullyRefunded: boolean; waitingRequest: boolean; refundedMinor: number }): Step[] {
  if (cart.released) {
    return [
      { label: 'Authorized', done: true },
      { label: 'Cancelled', done: true, at: cart.released.at, stop: true },
    ];
  }
  if (!o.paid) return [{ label: 'Authorized', done: true, at: cart.updatedAt }, { label: 'Shop confirms', done: false }, { label: 'Shipped', done: false }];

  const happened: { step: Step; t: number }[] = [{ step: { label: 'Paid', done: true, at: cart.paidAt ?? cart.updatedAt }, t: 0 }];
  if (cart.tracking) {
    const t = Date.parse(cart.tracking.addedAt);
    happened.push({ step: { label: 'Preparing', done: true }, t }, { step: { label: 'Shipped', done: true, at: cart.tracking.addedAt }, t });
  }
  const refunds = records.filter((r) => r.action.kind === 'refund.create');
  const asked = refunds
    .filter((r) => r.action.actor.side === 'buyer' && r.status !== 'denied' && r.status !== 'failed')
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1);
  const add = (label: string, at: string, stop?: true) => happened.push({ step: { label, done: true, at, ...(stop ? { stop } : {}) }, t: Date.parse(at) });
  if (asked) {
    add('Refund asked', asked.createdAt);
    if (asked.status === 'rejected') add('Refund declined', eventAt(asked, 'rejected'), true);
    if (asked.status === 'executing' || asked.status === 'executed' || asked.status === 'unverified') add('Refund sent', eventAt(asked, 'executed'));
  }
  const confirmed = refunds.filter((r) => r.status === 'verified').map((r) => eventAt(r, 'verified')).sort().at(-1);
  if (confirmed && o.refundedMinor > 0) add(o.fullyRefunded ? 'Refunded' : 'Partly refunded', confirmed);

  const next: Step[] = o.waitingRequest
    ? [{ label: 'Shop decides', done: false }]
    : !o.fullyRefunded && !cart.tracking
      ? [
          { label: 'Preparing', done: false },
          { label: 'Shipped', done: false },
        ]
      : [];
  return [...happened.sort((a, b) => a.t - b.t).map((h) => h.step), ...next];
}

/** The buyer's orders, as a note for the shopping assistant: enough to call get_cart and answer. */
export function ordersForAssistant(orders: readonly BuyerOrder[]): string {
  if (!orders.length) return '';
  const lines = orders.slice(0, 10).map((o) => `- ${o.number} from ${o.shop.name} (cart_id ${o.id}, ${o.placedAt.slice(0, 10)}): ${o.status}`);
  return `The shopper's own orders (they paid with PayPal; use get_cart with the cart_id for details or request_refund to ask for a refund):\n${lines.join('\n')}`;
}
