// A shop's orders day to day: listing, refunds, tracking and the demand it is missing. The owner's agent
// (MCP or CLI) and the dashboard both call this. Refunds go through Guard like every money movement.

import { HttpError, notFound } from './errors.ts';
import { carrierCode, trackingNumber } from './shipping.ts';
import type { Guard } from './guard/engine.ts';
import type { Actor, GuardRecord } from './guard/types.ts';
import { DEFAULT_CURRENCY, formatMoney, parseAmount, toMinor } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { addTracking } from './paypal/orders.ts';
import { resolvePeriod, salesSummary, type SalesQuery } from './sales-summary.ts';
import type { CartStore, StoredCart } from './stores.ts';
import type { Shop } from './catalog.ts';

export interface OrdersDeps {
  carts: CartStore;
  guard: Guard;
  paypal: PayPalClient;
}

export type OrderStatus = 'awaiting_buyer' | 'needs_info' | 'paid' | 'awaiting_owner' | 'released';

export interface OrderSummary {
  id: string;
  number?: string;
  status: OrderStatus;
  currency: string;
  /** Minor units, for sums; `total` is the same, formatted. */
  totalMinor?: number;
  total?: string;
  items: { name?: string; variant_id?: string; quantity: number }[];
  buyer?: string;
  channel?: string;
  /** Paid straight into the owner's PayPal (true), or into Sayso's account. */
  paidToOwner: boolean;
  tracking?: StoredCart['tracking'];
  /** Refunds confirmed with PayPal, in minor units, and formatted. */
  refundedMinor: number;
  refunded?: string;
  /** When it was charged (absent while held or cancelled). */
  paidAt?: string;
  createdAt: string;
}

/** Validation issues that mean a buyer wanted something the shop could not sell them. */
const MISSED = new Set(['INVENTORY_ISSUE', 'DATA_ERROR', 'SHIPPING_ERROR', 'BUSINESS_RULE_ERROR']);
const DEFAULT_LIMIT = 200;
/** Orders read for a sales summary: a safety cap, the period itself decides what is read. */
const SALES_LIMIT = 2_000;
/** Carts still with shoppers are only ever counted among the most recent ones. */
const OPEN_SCAN = 200;
const OPEN: readonly OrderStatus[] = ['awaiting_buyer', 'needs_info'];

export class Orders {
  private readonly deps: OrdersDeps;

  constructor(deps: OrdersDeps) {
    this.deps = deps;
  }

  /**
   * A shop's orders, newest first: placed ones (cancelled included), or carts still with shoppers when
   * `status` asks for those. `since`: placed at or after then. Refunds are read for these orders only.
   */
  async list(shopId: string, options: { status?: OrderStatus; limit?: number; since?: Date } = {}): Promise<OrderSummary[]> {
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT);
    const carts =
      options.status && OPEN.includes(options.status)
        ? (await this.deps.carts.listByShop(shopId, OPEN_SCAN)).filter((c) => c.cart.status !== 'COMPLETED')
        : await this.deps.carts.listPlaced(shopId, { limit: options.status ? DEFAULT_LIMIT : limit, since: options.since, released: true });
    const refunds = carts.length ? await this.deps.guard.list(shopId, { kind: 'refund.create', status: 'verified', cartIds: carts.map((c) => c.id), limit: SALES_LIMIT }) : [];
    return carts
      .map((c) => summarize(c, refunds))
      .filter((o) => !options.status || o.status === options.status)
      .slice(0, limit);
  }

  /** How many recent carts are still with shoppers (priced, not paid). */
  async openCarts(shopId: string): Promise<number> {
    return (await this.deps.carts.listByShop(shopId, OPEN_SCAN)).filter((c) => c.cart.status !== 'COMPLETED').length;
  }

  /** One order with its Guard history. `ref` is the cart id or the order number people see (SAY-...). */
  async get(shopId: string, ref: string): Promise<{ order: OrderSummary; cart: StoredCart; records: GuardRecord[] }> {
    const cart = await this.cart(shopId, ref);
    const records = await this.deps.guard.list(shopId, { cartId: cart.id });
    return { order: summarize(cart, records), cart, records };
  }

  /** The Guard history of several orders, in one read. */
  history(shopId: string, cartIds: readonly string[]): Promise<GuardRecord[]> {
    return cartIds.length ? this.deps.guard.list(shopId, { cartIds, limit: SALES_LIMIT }) : Promise.resolve([]);
  }

  /** Refund all or part of a paid order. May run now, wait for the owner, or be denied by the rules. */
  async refund(shopId: string, ref: string, input: { amount?: string; reason: string }, actor: Actor): Promise<GuardRecord> {
    const cart = await this.cart(shopId, ref);
    if (!cart.captureId || !cart.orderId) throw new HttpError(422, 'This order has not been charged, so there is nothing to refund');
    const currency = cart.cart.totals?.total.currency_code ?? DEFAULT_CURRENCY;
    const amount = input.amount === undefined ? undefined : parseAmount(input.amount, currency);
    if (input.amount !== undefined && !amount) throw new HttpError(400, `Amount must look like 12.50 (${currency})`);
    return this.deps.guard.submit({
      kind: 'refund.create',
      actor,
      ownerId: shopId,
      amount,
      currency,
      counterparty: cart.payerEmail ?? cart.cart.customer?.email_address,
      resourceId: cart.captureId,
      reason: input.reason.trim().slice(0, 300) || 'Refund',
      params: { orderId: cart.orderId, cartId: cart.id },
    });
  }

  /** Sales, refunds and net for a period, against the one before, computed from the orders themselves. */
  async salesSummary(shop: Pick<Shop, 'id' | 'currency' | 'timeZone'>, query: SalesQuery, now = new Date()) {
    const shopId = shop.id;
    const zone = shop.timeZone ?? 'UTC';
    // Refunds asked for since a while before the period before began (one asked earlier can be confirmed
    // later): the window decides what is read, not the store's default page size.
    const since = new Date(resolvePeriod(query, now, zone).previous.start - 60 * 86_400_000);
    const [placed, refunds] = await Promise.all([
      // Orders placed since then too: one paid in the period may have been placed a little before it.
      this.deps.carts.listPlaced(shopId, { limit: SALES_LIMIT, since }),
      this.deps.guard.list(shopId, { kind: 'refund.create', status: 'verified', since, limit: SALES_LIMIT }),
    ]);
    return salesSummary({ placed, refunds, currency: shop.currency, query, now, zone, partial: placed.length >= SALES_LIMIT || refunds.length >= SALES_LIMIT });
  }

  /** Not a money movement, so no Guard round-trip; still idempotent per order + tracking number. */
  async addTracking(shopId: string, ref: string, carrier: string, tracking: string): Promise<OrderSummary> {
    const code = carrierCode(carrier);
    const number = trackingNumber(tracking);
    if (!code) throw new HttpError(400, 'Pick the carrier');
    if (!number) throw new HttpError(400, 'Enter the tracking number as printed on the label (8 to 40 letters and digits)');
    const cart = await this.cart(shopId, ref);
    if (!cart.captureId || !cart.orderId) throw new HttpError(422, 'Tracking can be added once the order is paid');
    // The same number, however it was typed, is the same request to PayPal.
    await addTracking(this.deps.paypal, cart.orderId, { captureId: cart.captureId, trackingNumber: number, carrier: code }, `${cart.id}-track-${number}`);
    cart.tracking = { carrier: code, number, addedAt: new Date().toISOString() };
    await this.deps.carts.put(cart);
    return summarize(cart);
  }

  /** What agents tried to buy and couldn't: the demand a seller is missing. */
  async missedDemand(shopId: string): Promise<{ variant_id?: string; code: string; message: string; at: string }[]> {
    const carts = await this.deps.carts.listByShop(shopId, DEFAULT_LIMIT);
    return carts.flatMap((c) =>
      (c.cart.validation_issues ?? []).filter((i) => MISSED.has(i.code)).map((i) => ({ variant_id: i.variant_id, code: i.code, message: i.user_message ?? i.message, at: c.updatedAt })),
    );
  }

  private async cart(shopId: string, ref: string): Promise<StoredCart> {
    const cart = /^SAY-/i.test(ref) ? await this.deps.carts.byNumber(shopId, ref) : await this.deps.carts.get(ref);
    if (!cart || cart.shopId !== shopId) throw notFound(`Order ${ref}`);
    return cart;
  }
}

/** An order as the owner sees it. `records` may hold any of the shop's records; only this cart's verified refunds count. */
export function summarize(c: StoredCart, records: readonly GuardRecord[] = []): OrderSummary {
  const totals = c.cart.totals?.total;
  const currency = totals?.currency_code ?? DEFAULT_CURRENCY;
  const refundedMinor = records
    .filter((r) => r.action.kind === 'refund.create' && r.status === 'verified' && r.action.params?.cartId === c.id)
    .reduce((sum, r) => sum + (r.action.amount ?? 0), 0);
  const totalMinor = totals ? toMinor(totals) : undefined;
  return {
    id: c.id,
    number: c.merchantOrderNumber,
    status: statusOf(c),
    currency,
    totalMinor,
    total: totalMinor === undefined ? undefined : formatMoney(totalMinor, currency),
    items: c.cart.items.map((i) => ({ name: i.name, variant_id: i.variant_id, quantity: i.quantity })),
    buyer: c.payerEmail ?? c.cart.customer?.email_address,
    channel: c.channel,
    paidToOwner: Boolean(c.payee),
    tracking: c.tracking,
    refundedMinor,
    refunded: refundedMinor ? formatMoney(refundedMinor, currency) : undefined,
    ...(c.captureId && c.paidAt ? { paidAt: c.paidAt } : {}),
    createdAt: c.createdAt,
  };
}

function statusOf(c: StoredCart): OrderStatus {
  if (c.cart.status === 'COMPLETED') return c.released ? 'released' : c.captureId ? 'paid' : 'awaiting_owner';
  return c.cart.validation_status === 'VALID' ? 'awaiting_buyer' : 'needs_info';
}
