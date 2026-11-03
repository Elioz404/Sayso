// Guard executors for money-moving PayPal calls. Each one simulates against live PayPal state first
// (so impossible or harmful calls are blocked before they are made, and an amount left out is resolved
// to what would really move), executes with the Guard record's idempotency key, then reads the result
// back and checks it moved exactly what was approved.

import type { Executor, ProposedAction } from '../guard/types.ts';
import { formatMoney, toMinor, toMoney } from '../money.ts';
import type { PayPalClient } from './client.ts';
import { captureAuthorization, getAuthorization, getCapture, getOrder, getRefund, refundCapture, voidAuthorization } from './orders.ts';

const CAPTURABLE = new Set(['CREATED', 'PARTIALLY_CAPTURED', 'PENDING']);
const MOVED = new Set(['COMPLETED', 'PENDING']);

export function captureExecutor(client: PayPalClient): Executor {
  return {
    async simulate(action) {
      const auth = await getAuthorization(client, need(action.resourceId, 'resourceId (authorization id)'));
      const currency = auth.amount.currency_code;
      const authorized = toMinor(auth.amount);
      const amount = action.amount ?? authorized;
      const blockers: string[] = [];
      if (!CAPTURABLE.has(auth.status)) blockers.push(`Authorization is ${auth.status}; it can't be captured.`);
      if (amount > authorized) blockers.push(`Capture ${formatMoney(amount, currency)} exceeds the authorized ${formatMoney(authorized, currency)}.`);
      if (auth.expiration_time && Date.parse(auth.expiration_time) < Date.now()) blockers.push('Authorization has expired.');
      return {
        ok: blockers.length === 0,
        blockers,
        amount,
        effects: [`Charge the buyer ${formatMoney(amount, currency)} (authorized ${formatMoney(authorized, currency)}).`],
        observed: { authorization_status: auth.status, expires: auth.expiration_time },
      };
    },
    async execute(action, key) {
      const auth = await getAuthorization(client, need(action.resourceId, 'resourceId'));
      const amount = action.amount !== undefined ? toMoney(action.amount, auth.amount.currency_code) : auth.amount;
      const capture = await captureAuthorization(client, auth.id, amount, key);
      return { capture_id: capture.id, status: capture.status, amount: capture.amount };
    },
    async verify(action, result) {
      const capture = await getCapture(client, String(result.capture_id));
      const amountOk = action.amount === undefined || toMinor(capture.amount) === action.amount;
      return {
        ok: MOVED.has(capture.status) && amountOk,
        detail: `Capture ${capture.id} is ${capture.status} for ${formatMoney(toMinor(capture.amount), capture.amount.currency_code)}.`,
        observed: { status: capture.status },
      };
    },
  };
}

export function voidExecutor(client: PayPalClient): Executor {
  return {
    async simulate(action) {
      const auth = await getAuthorization(client, need(action.resourceId, 'resourceId (authorization id)'));
      const ok = CAPTURABLE.has(auth.status);
      return {
        ok,
        blockers: ok ? [] : [`Authorization is ${auth.status}; nothing to release.`],
        amount: 0, // releasing a hold moves no money
        effects: [`Release the ${formatMoney(toMinor(auth.amount), auth.amount.currency_code)} hold. The buyer is not charged.`],
        observed: { authorization_status: auth.status },
      };
    },
    async execute(action, key) {
      const authorizationId = need(action.resourceId, 'resourceId');
      await voidAuthorization(client, authorizationId, key);
      return { authorization_id: authorizationId };
    },
    async verify(action) {
      const auth = await getAuthorization(client, need(action.resourceId, 'resourceId'));
      return { ok: auth.status === 'VOIDED', detail: `Authorization is ${auth.status}.` };
    },
  };
}

/** The PayPal merchant id an owner connected for payouts, if any. */
export type PayoutLookup = (ownerId: string) => Promise<string | undefined>;

/**
 * Refunds need `resourceId` = capture id and `params.orderId`, so the simulation can sum earlier
 * refunds on the order and block anything above what is still refundable. Leaving the amount out
 * refunds everything still refundable, and the rules judge that amount.
 *
 * A sale paid straight into the owner's own PayPal is refunded from that account, acting for them with
 * the permission they granted at onboarding. The order says who was paid, so a sale from before they
 * connected is still refunded from Sayso's account, where its money went.
 */
export function refundExecutor(client: PayPalClient, payouts?: PayoutLookup): Executor {
  async function payer(action: ProposedAction): Promise<PayPalClient> {
    const merchantId = await payouts?.(action.ownerId);
    if (!merchantId) return client;
    const order = await getOrder(client, need(action.params?.orderId as string | undefined, 'params.orderId'));
    return order.purchase_units.some((u) => u.payee?.merchant_id === merchantId) ? client.actingAs(merchantId) : client;
  }

  return {
    async simulate(action) {
      const captureId = need(action.resourceId, 'resourceId (capture id)');
      const order = await getOrder(client, need(action.params?.orderId as string | undefined, 'params.orderId'));
      const payments = order.purchase_units.flatMap((u) => u.payments ?? []);
      const capture = payments.flatMap((p) => p.captures ?? []).find((c) => c.id === captureId);
      if (!capture) return { ok: false, effects: [], blockers: [`Capture ${captureId} is not part of order ${order.id}.`] };

      const currency = capture.amount.currency_code;
      const fmt = (minor: number) => formatMoney(minor, currency);
      const captured = toMinor(capture.amount);
      const refunded = payments
        .flatMap((p) => p.refunds ?? [])
        .filter((r) => MOVED.has(r.status))
        .reduce((sum, r) => sum + toMinor(r.amount), 0);
      const refundable = captured - refunded;
      const amount = action.amount ?? refundable;
      const blockers: string[] = [];
      if (refundable <= 0) blockers.push('This payment has already been fully refunded.');
      else if (amount <= 0) blockers.push('A refund must be more than zero.');
      else if (amount > refundable) blockers.push(`Refund ${fmt(amount)} exceeds the ${fmt(refundable)} still refundable.`);

      const already = refunded ? ` (already refunded ${fmt(refunded)})` : '';
      return {
        ok: blockers.length === 0,
        blockers,
        amount,
        effects: blockers.length
          ? [`Nothing would move: ${fmt(Math.max(0, refundable))} of ${fmt(captured)} is still refundable${already}.`]
          : [`Refund ${fmt(amount)} to the buyer${already}.`, `${fmt(refundable - amount)} of ${fmt(captured)} stays captured.`],
        observed: { captured, refunded, refundable, currency },
      };
    },
    async execute(action, key) {
      const as = await payer(action);
      const capture = await getCapture(as, need(action.resourceId, 'resourceId'));
      // Guard filled in the amount from the simulation, so a "full" refund is an exact amount too.
      const amount = toMoney(need(action.amount, 'amount'), capture.amount.currency_code);
      const refund = await refundCapture(as, capture.id, amount, action.reason, key);
      return { refund_id: refund.id, status: refund.status, amount: refund.amount };
    },
    async verify(action, result) {
      const refund = await getRefund(await payer(action), String(result.refund_id));
      const ok = MOVED.has(refund.status) && toMinor(refund.amount) === action.amount;
      return { ok, detail: `Refund ${refund.id} is ${refund.status} for ${formatMoney(toMinor(refund.amount), refund.amount.currency_code)}.` };
    },
  };
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null || value === '') throw new Error(`Missing ${what}`);
  return value;
}
