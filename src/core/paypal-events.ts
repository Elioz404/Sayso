// What PayPal tells Sayso through its webhooks, kept in step with Sayso's own state. Money can move in
// PayPal without Sayso: the owner refunds from their PayPal account, PayPal reverses a payment, a hold is
// voided or runs out, a buyer opens a dispute, a seller takes back the permissions they gave. Each event
// is only a hint: Sayso finds the order it is about, reads the resource back from PayPal with the account
// that owns it, checks it really belongs to that order, and only then records it. Every handler can run
// twice for the same event (PayPal resends) and changes nothing the second time.
//
// Money that moved in PayPal becomes a Guard record ("Done in PayPal"), so the audit trail, the order,
// the sales figures and the owner's Activity match PayPal, and nothing is counted twice: Sayso's own
// refunds carry their Guard record's key as PayPal's custom_id and are recognised as Sayso's.

import { IN_PAYPAL } from './actors.ts';
import type { Commerce } from './commerce.ts';
import type { Guard } from './guard/engine.ts';
import type { GuardRecord } from './guard/types.ts';
import type { Invoicing } from './invoicing.ts';
import { formatMoney, toMinor } from './money.ts';
import { PayPalError, type PayPalClient } from './paypal/client.ts';
import { getDispute } from './paypal/disputes.ts';
import { getAuthorization, getCapture, getRefund, refundedCaptureId } from './paypal/orders.ts';
import type { WebhookEvent } from './paypal/webhooks.ts';
import type { Payouts } from './payouts.ts';
import type { CartStore, OrderDispute, StoredCart } from './stores.ts';

export interface PayPalEventsDeps {
  paypal: PayPalClient;
  carts: CartStore;
  guard: Guard;
  commerce: Commerce;
  invoicing: Invoicing;
  payouts: Payouts;
}

/** What an event led to, for the delivery log and tests. */
export interface EventOutcome {
  result: 'recorded' | 'known' | 'released' | 'updated' | 'refreshed' | 'connected' | 'disconnected' | 'unchanged' | 'not-ours' | 'ignored';
  shopId?: string;
  detail?: string;
}

/** The events Sayso subscribes to. Anything else is acknowledged and ignored. */
export const SUBSCRIBED_EVENTS = [
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.AUTHORIZATION.VOIDED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.REFUNDED',
  'MERCHANT.ONBOARDING.COMPLETED',
  'MERCHANT.PARTNER-CONSENT.REVOKED',
] as const;

type Linked = { links?: { rel: string; href: string }[] };

/** Refund states where the money has left (or is leaving) the shop. */
const MOVED = new Set(['COMPLETED', 'PENDING']);
const HOLD_ENDED = new Set(['VOIDED', 'EXPIRED']);
/** One order's refunds read to tell Sayso's own from the ones made in PayPal. */
const ORDER_REFUNDS = 200;

export class PayPalEvents {
  private readonly deps: PayPalEventsDeps;

  constructor(deps: PayPalEventsDeps) {
    this.deps = deps;
  }

  async handle(event: WebhookEvent): Promise<EventOutcome> {
    const r = event.resource;
    switch (event.event_type) {
      case 'PAYMENT.CAPTURE.REFUNDED':
        return this.refunded(event, text(r.id), refundedCaptureId(r as Linked));
      case 'PAYMENT.CAPTURE.REVERSED': {
        // PayPal reports a reversal as the refund it made (linked up to its capture), or as the capture itself.
        const up = refundedCaptureId(r as Linked);
        return up ? this.refunded(event, text(r.id), up) : this.reversed(event, text(r.id));
      }
      case 'PAYMENT.AUTHORIZATION.VOIDED':
        return this.holdEnded(text(r.id));
      case 'CUSTOMER.DISPUTE.CREATED':
      case 'CUSTOMER.DISPUTE.UPDATED':
      case 'CUSTOMER.DISPUTE.RESOLVED':
        return this.disputed(text(r.dispute_id), disputedCapture(r));
      case 'INVOICING.INVOICE.PAID':
      case 'INVOICING.INVOICE.CANCELLED':
      case 'INVOICING.INVOICE.REFUNDED': {
        const id = text(r.id) ?? text((r.invoice as Record<string, unknown> | undefined)?.id);
        if (!id) return { result: 'ignored' };
        this.deps.invoicing.forget(id);
        return { result: 'refreshed', detail: `Invoice ${id} is read from PayPal again` };
      }
      case 'MERCHANT.ONBOARDING.COMPLETED':
        return this.onboarded(text(r.tracking_id));
      case 'MERCHANT.PARTNER-CONSENT.REVOKED': {
        const merchantId = text(r.merchant_id);
        const checked = merchantId ? await this.deps.payouts.recheck(merchantId) : undefined;
        if (!checked) return { result: 'not-ours' };
        return { result: checked.connected ? 'unchanged' : 'disconnected', shopId: checked.shopId };
      }
      default:
        return { result: 'ignored' };
    }
  }

  /** A refund of one of Sayso's orders: Sayso's own, or one made in PayPal (recorded once). */
  private async refunded(event: WebhookEvent, refundId: string | undefined, captureId: string | undefined): Promise<EventOutcome> {
    const cart = captureId ? await this.order(captureId, 'capture') : undefined;
    if (!refundId || !cart) return { result: 'not-ours' };
    const refund = await readBack(() => getRefund(this.clientFor(cart), refundId));
    if (!refund || refundedCaptureId(refund) !== cart.captureId) return { result: 'not-ours', shopId: cart.shopId };
    if (!MOVED.has(refund.status)) return { result: 'unchanged', shopId: cart.shopId, detail: `Refund ${refund.id} is ${refund.status}` };

    const records = await this.refundsOf(cart);
    const ours = records.find((rec) => rec.result?.refund_id === refund.id || rec.result?.paypal_id === refund.id || (refund.custom_id !== undefined && rec.idempotencyKey === refund.custom_id));
    if (ours) return { result: 'known', shopId: cart.shopId, detail: `Refund ${refund.id} is Sayso's own (${ours.id})` };

    const amount = toMinor(refund.amount);
    const reversal = event.event_type === 'PAYMENT.CAPTURE.REVERSED';
    const record = await this.deps.guard.recordExternal(
      {
        kind: 'refund.create',
        actor: IN_PAYPAL,
        ownerId: cart.shopId,
        amount,
        currency: refund.amount.currency_code,
        counterparty: cart.payerEmail,
        resourceId: cart.captureId,
        reason: reversal ? 'PayPal reversed this payment' : 'Refunded in PayPal, outside Sayso',
        params: { cartId: cart.id, orderId: cart.orderId, refundId: refund.id },
      },
      { paypalId: refund.id, status: refund.status, detail: `Refund ${refund.id} is ${refund.status} for ${formatMoney(amount, refund.amount.currency_code)}, read back from PayPal.`, eventId: event.id },
    );
    return { result: 'recorded', shopId: cart.shopId, detail: record.id };
  }

  /** PayPal took back a whole payment: whatever was still captured is recorded as gone. */
  private async reversed(event: WebhookEvent, captureId: string | undefined): Promise<EventOutcome> {
    const cart = captureId ? await this.order(captureId, 'capture') : undefined;
    if (!cart) return { result: 'not-ours' };
    const capture = await readBack(() => getCapture(this.clientFor(cart), cart.captureId!));
    if (!capture || capture.status !== 'REVERSED') return { result: 'unchanged', shopId: cart.shopId, detail: capture && `Capture ${capture.id} is ${capture.status}` };

    const key = `${capture.id}:reversed`;
    const records = await this.refundsOf(cart);
    const known = records.find((rec) => rec.result?.paypal_id === key);
    if (known) return { result: 'known', shopId: cart.shopId, detail: known.id };
    const refunded = records.filter((rec) => rec.status === 'verified').reduce((n, rec) => n + (rec.action.amount ?? 0), 0);
    const amount = Math.max(0, toMinor(capture.amount) - refunded);
    if (!amount) return { result: 'unchanged', shopId: cart.shopId, detail: 'Everything was already refunded' };
    const record = await this.deps.guard.recordExternal(
      {
        kind: 'refund.create',
        actor: IN_PAYPAL,
        ownerId: cart.shopId,
        amount,
        currency: capture.amount.currency_code,
        counterparty: cart.payerEmail,
        resourceId: capture.id,
        reason: 'PayPal reversed this payment',
        params: { cartId: cart.id, orderId: cart.orderId },
      },
      { paypalId: key, status: capture.status, detail: `Capture ${capture.id} is REVERSED in PayPal; ${formatMoney(amount, capture.amount.currency_code)} went back to the buyer.`, eventId: event.id },
    );
    return { result: 'recorded', shopId: cart.shopId, detail: record.id };
  }

  /** A placed order's hold ended in PayPal before the order was charged: the order is released. */
  private async holdEnded(authorizationId: string | undefined): Promise<EventOutcome> {
    const cart = authorizationId ? await this.order(authorizationId, 'authorization') : undefined;
    if (!cart) return { result: 'not-ours' };
    const authorization = await readBack(() => getAuthorization(this.clientFor(cart), cart.authorizationId!));
    if (!authorization || !HOLD_ENDED.has(authorization.status)) return { result: 'unchanged', shopId: cart.shopId, detail: authorization && `Authorization is ${authorization.status}` };
    const released = await this.deps.commerce.holdEndedInPayPal(cart.id, authorization.status);
    return { result: released ? 'released' : 'known', shopId: cart.shopId };
  }

  /** A buyer's dispute about one of Sayso's orders, kept on the order as PayPal has it now. */
  private async disputed(disputeId: string | undefined, captureId: string | undefined): Promise<EventOutcome> {
    const cart = captureId ? await this.order(captureId, 'capture') : undefined;
    if (!disputeId || !cart) return { result: 'not-ours' };
    const dispute = await readBack(() => getDispute(this.clientFor(cart), disputeId));
    if (!dispute || !dispute.disputed_transactions?.some((t) => t.seller_transaction_id === cart.captureId)) return { result: 'not-ours', shopId: cart.shopId };
    const amount = dispute.dispute_amount ?? cart.cart.totals?.total;
    const noted: OrderDispute = {
      id: dispute.dispute_id,
      reason: dispute.reason,
      status: dispute.status,
      amount: amount ? toMinor(amount) : 0,
      currency: amount?.currency_code ?? 'USD',
      openedAt: dispute.create_time,
      updatedAt: dispute.update_time ?? dispute.create_time,
      ...(dispute.seller_response_due_date ? { respondBy: dispute.seller_response_due_date } : {}),
      ...(dispute.dispute_outcome?.outcome_code ? { outcome: dispute.dispute_outcome.outcome_code } : {}),
    };
    const changed = await this.deps.commerce.noteDispute(cart.id, noted);
    return { result: changed ? 'updated' : 'known', shopId: cart.shopId, detail: `${dispute.dispute_id} ${dispute.status}` };
  }

  /** A seller finished connecting their PayPal: the same check as when PayPal sends them back. */
  private async onboarded(shopId: string | undefined): Promise<EventOutcome> {
    if (!shopId || !this.deps.payouts.enabled) return { result: 'not-ours' };
    const outcome = await this.deps.payouts.finish(shopId).catch(() => undefined);
    if (!outcome) return { result: 'not-ours' };
    return { result: outcome.status === 'connected' ? 'connected' : 'unchanged', shopId, detail: outcome.status };
  }

  /** The order a payment belongs to, only if it really is that order's capture (or hold). */
  private async order(paypalId: string, as: 'capture' | 'authorization'): Promise<StoredCart | undefined> {
    const cart = await this.deps.carts.byPayment(paypalId);
    return cart && (as === 'capture' ? cart.captureId : cart.authorizationId) === paypalId ? cart : undefined;
  }

  private refundsOf(cart: StoredCart): Promise<GuardRecord[]> {
    return this.deps.guard.list(cart.shopId, { cartId: cart.id, kind: 'refund.create', limit: ORDER_REFUNDS });
  }

  /** The PayPal account an order was paid into: the owner's (acting for them), or Sayso's. */
  private clientFor(cart: StoredCart): PayPalClient {
    return cart.payee ? this.deps.paypal.actingAs(cart.payee) : this.deps.paypal;
  }
}

/** A resource PayPal doesn't have (or won't show this account) is not one of Sayso's: anything else is a real failure. */
async function readBack<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof PayPalError && (err.status === 404 || err.status === 403)) return undefined;
    throw err;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function disputedCapture(resource: Record<string, unknown>): string | undefined {
  const transactions = resource.disputed_transactions;
  if (!Array.isArray(transactions)) return undefined;
  return transactions.map((t) => text((t as Record<string, unknown>)?.seller_transaction_id)).find(Boolean);
}
