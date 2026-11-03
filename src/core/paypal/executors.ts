// Guard executors for money-moving PayPal calls. Each one simulates against live PayPal state first
// (so impossible or harmful calls are blocked before they are made), executes with the Guard
// record's idempotency key, then reads the result back to verify it.

import type { Executor } from '../guard/types.ts';
import { formatMoney, toMinor, toMoney } from '../money.ts';
import type { PayPalClient } from './client.ts';
import {
  captureAuthorization,
  getAuthorization,
  getCapture,
  getOrder,
  getRefund,
  refundCapture,
  voidAuthorization,
} from './orders.ts';

const CAPTURABLE = new Set(['CREATED', 'PARTIALLY_CAPTURED', 'PENDING']);

export function captureExecutor(client: PayPalClient): Executor {
  return {
    async simulate(action) {
      const auth = await getAuthorization(client, need(action.resourceId, 'resourceId (authorization id)'));
      const authorized = toMinor(auth.amount);
      const amount = action.amount ?? authorized;
      const blockers: string[] = [];
      if (!CAPTURABLE.has(auth.status)) blockers.push(`Authorization is ${auth.status}; it can't be captured.`);
      if (amount > authorized) blockers.push(`Capture ${fmt(amount, auth.amount.currency_code)} exceeds the authorized ${fmt(authorized, auth.amount.currency_code)}.`);
      if (auth.expiration_time && Date.parse(auth.expiration_time) < Date.now()) blockers.push('Authorization has expired.');
      return {
        ok: blockers.length === 0,
        blockers,
        effects: [`Charge the buyer ${fmt(amount, auth.amount.currency_code)} (authorized ${fmt(authorized, auth.amount.currency_code)}).`],
        observed: { authorization_status: auth.status, expires: auth.expiration_time },
      };
    },
    async execute(action, key) {
      const auth = await getAuthorization(client, action.resourceId!);
      const amount = action.amount !== undefined ? toMoney(action.amount, auth.amount.currency_code) : auth.amount;
      const capture = await captureAuthorization(client, auth.id, amount, key);
      return { capture_id: capture.id, status: capture.status, amount: capture.amount };
    },
    async verify(_action, result) {
      const capture = await getCapture(client, String(result.capture_id));
      const ok = capture.status === 'COMPLETED' || capture.status === 'PENDING';
      return { ok, detail: `Capture ${capture.id} is ${capture.status}.`, observed: { status: capture.status } };
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
        effects: [`Release the ${fmt(toMinor(auth.amount), auth.amount.currency_code)} hold. The buyer is not charged.`],
        observed: { authorization_status: auth.status },
      };
    },
    async execute(action, key) {
      await voidAuthorization(client, action.resourceId!, key);
      return { authorization_id: action.resourceId };
    },
    async verify(action) {
      const auth = await getAuthorization(client, action.resourceId!);
      return { ok: auth.status === 'VOIDED', detail: `Authorization is ${auth.status}.` };
    },
  };
}

/**
 * Refunds need `resourceId` = capture id and `params.orderId`, so the simulation can sum earlier
 * refunds on the order and block anything above what is still refundable.
 */
export function refundExecutor(client: PayPalClient): Executor {
  return {
    async simulate(action) {
      const captureId = need(action.resourceId, 'resourceId (capture id)');
      const order = await getOrder(client, need(action.params?.orderId as string | undefined, 'params.orderId'));
      const payments = order.purchase_units.flatMap((u) => u.payments ?? []);
      const capture = payments.flatMap((p) => p.captures ?? []).find((c) => c.id === captureId);
      if (!capture) return { ok: false, effects: [], blockers: [`Capture ${captureId} is not part of order ${order.id}.`] };

      const currency = capture.amount.currency_code;
      const captured = toMinor(capture.amount);
      const refunded = payments
        .flatMap((p) => p.refunds ?? [])
        .filter((r) => r.status === 'COMPLETED' || r.status === 'PENDING')
        .reduce((sum, r) => sum + toMinor(r.amount), 0);
      const refundable = captured - refunded;
      const amount = action.amount ?? refundable;
      const blockers: string[] = [];
      if (refundable <= 0) blockers.push('This payment has already been fully refunded.');
      else if (amount > refundable) blockers.push(`Refund ${fmt(amount, currency)} exceeds the ${fmt(refundable, currency)} still refundable.`);

      return {
        ok: blockers.length === 0,
        blockers,
        effects: [
          `Refund ${fmt(amount, currency)} to the buyer${refunded ? ` (already refunded ${fmt(refunded, currency)})` : ''}.`,
          `${fmt(Math.max(0, refundable - amount), currency)} of ${fmt(captured, currency)} stays captured.`,
        ],
        observed: { captured, refunded, refundable, currency },
      };
    },
    async execute(action, key) {
      const capture = await getCapture(client, action.resourceId!);
      const amount = action.amount !== undefined ? toMoney(action.amount, capture.amount.currency_code) : capture.amount;
      const refund = await refundCapture(client, capture.id, amount, action.reason, key);
      return { refund_id: refund.id, status: refund.status, amount: refund.amount };
    },
    async verify(action, result) {
      const refund = await getRefund(client, String(result.refund_id));
      const amountOk = action.amount === undefined || toMinor(refund.amount) === action.amount;
      const ok = (refund.status === 'COMPLETED' || refund.status === 'PENDING') && amountOk;
      return { ok, detail: `Refund ${refund.id} is ${refund.status} for ${refund.amount.value} ${refund.amount.currency_code}.` };
    },
  };
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null || value === '') throw new Error(`Missing ${what}`);
  return value;
}

function fmt(minor: number, currency: string): string {
  return formatMoney(minor, currency);
}
