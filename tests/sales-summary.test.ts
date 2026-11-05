// Sales for a period, computed from the orders themselves: charged sales by when they were charged,
// refunds by when PayPal confirmed them, against the period before, with an estimate while it runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GuardRecord } from '../src/core/guard/types.ts';
import { change, resolvePeriod, salesSummary } from '../src/core/sales-summary.ts';
import type { StoredCart } from '../src/core/stores.ts';

const NOW = new Date('2026-11-20T12:00:00Z');
const usd = (value: string) => ({ currency_code: 'USD', value });

function order(id: string, paidAt: string | undefined, total: string, extra: Partial<StoredCart> = {}): StoredCart {
  return {
    id,
    shopId: 'shop_x',
    cart: { id, status: 'COMPLETED', items: [{ variant_id: 'v1', name: 'Hand-thrown Mug - Sage', quantity: 2, price: usd((Number(total) / 2).toFixed(2)) }], totals: { total: usd(total) } } as StoredCart['cart'],
    ...(paidAt ? { captureId: `cap_${id}`, paidAt } : {}),
    channel: 'sayso-assistant',
    createdAt: paidAt ?? '2026-11-18T10:00:00Z',
    updatedAt: paidAt ?? '2026-11-18T10:00:00Z',
    ...extra,
  };
}

function refund(amount: number, verifiedAt: string, cartId: string): GuardRecord {
  return {
    id: `say_${verifiedAt}`,
    createdAt: verifiedAt,
    action: { kind: 'refund.create', actor: { type: 'agent', id: 'agent:x:k', side: 'merchant' }, ownerId: 'shop_x', amount, currency: 'USD', reason: 'Chipped', params: { cartId } },
    status: 'verified',
    idempotencyKey: 'k',
    events: [{ at: verifiedAt, type: 'verified', by: 'sayso', hash: 'h' }],
  } as GuardRecord;
}

const placed = [
  order('a', '2026-11-03T09:00:00Z', '100.00'),
  order('b', '2026-11-15T09:00:00Z', '50.00', { channel: 'mcp-client' }),
  order('c', '2026-10-20T09:00:00Z', '80.00'),
  order('held', undefined, '40.00'), // authorized, waiting for the owner: not a sale yet
  order('gone', '2026-11-05T09:00:00Z', '999.00', { released: { at: '2026-11-05T10:00:00Z', reason: 'x', holdVoided: true } }),
];
const refunds = [refund(2_000, '2026-11-10T09:00:00Z', 'c'), refund(1_000, '2026-10-25T09:00:00Z', 'c')];

test('this month against last month, with refunds dated when PayPal confirmed them', () => {
  const s = salesSummary({ placed, refunds, currency: 'USD', query: {}, now: NOW });
  assert.equal(s.period, 'this month');
  assert.deepEqual([s.from, s.to], ['2026-11-01', '2026-11-30']);
  assert.equal(s.sales, '$150.00', 'charged orders only: not the held one, not the released one');
  assert.equal(s.orders, 2);
  assert.equal(s.average_order, '$75.00');
  assert.equal(s.refunds, '$20.00', "a refund this month on last month's order counts this month");
  assert.equal(s.refund_count, 1);
  assert.equal(s.net, '$130.00');
  assert.equal(s.refund_rate, '13.3%');
  // Like with like: last month up to the same point (Oct 1 to Oct 20, midday), where order c falls and its refund doesn't.
  assert.deepEqual(s.compared_with, { period: 'last month, up to the same point', sales: '$80.00', orders: 1, refunds: '$0.00', net: '$80.00', change: { sales: '+88%', orders: '+100%', net: '+63%' } });
  assert.deepEqual(s.all_of_the_period_before, { period: 'last month', sales: '$80.00', orders: 1, net: '$70.00' });
  assert.deepEqual(s.waiting_for_owner_now, { orders: 1, amount: '$40.00' });
  assert.equal(s.estimate?.sales, '$225.00', '150 over 20 of 30 days');
  assert.equal(s.estimate?.orders, 3);
  assert.deepEqual(s.top_products, [{ name: 'Hand-thrown Mug - Sage', units: 4, sales: '$150.00' }]);
  assert.deepEqual(
    s.channels.map((c) => [c.channel, c.orders, c.sales]),
    [
      ['Shop with AI on Sayso', 1, '$100.00'],
      ['AI assistants over MCP', 1, '$50.00'],
    ],
  );
  assert.ok(s.notes.some((n) => /fees/.test(n)));
});

test('a finished period has no estimate; a custom range compares with the days before', () => {
  const last = salesSummary({ placed, refunds, currency: 'USD', query: { period: 'last_month' }, now: NOW });
  assert.equal(last.sales, '$80.00');
  assert.equal(last.refunds, '$10.00');
  assert.equal(last.estimate, undefined);
  assert.equal(last.all_of_the_period_before, undefined, 'a finished period is compared whole');
  assert.equal(last.compared_with.period, 'the month before');

  const range = salesSummary({ placed, refunds, currency: 'USD', query: { from: '2026-11-01', to: '2026-11-10' }, now: NOW });
  assert.equal(range.sales, '$100.00');
  assert.equal(range.compared_with.period, 'the same number of days before');
  // The 10 days before Nov 1 are Oct 22-31: order c (Oct 20) is outside, its Oct 25 refund inside.
  assert.equal(range.compared_with.sales, '$0.00');
  assert.equal(range.compared_with.refunds, '$10.00');
});

test("periods follow the shop's own days, daylight saving included", () => {
  const LA = 'America/Los_Angeles';
  const evening = new Date('2026-11-05T03:00:00Z'); // 7 pm on Nov 4 in Los Angeles (PST, UTC-8)
  const today = resolvePeriod({ period: 'today' }, evening, LA).current;
  assert.deepEqual([new Date(today.start).toISOString(), new Date(today.end).toISOString()], ['2026-11-04T08:00:00.000Z', '2026-11-05T08:00:00.000Z']);
  // November began on summer time (UTC-7); clocks went back that night.
  const month = resolvePeriod({ period: 'this_month' }, evening, LA).current;
  assert.equal(new Date(month.start).toISOString(), '2026-11-01T07:00:00.000Z');
  const summary = salesSummary({ placed: [order('late', '2026-11-05T02:00:00Z', '20.00')], refunds: [], currency: 'USD', query: { period: 'today' }, now: evening, zone: LA });
  assert.deepEqual([summary.from, summary.to, summary.time_zone, summary.orders], ['2026-11-04', '2026-11-04', LA, 1]);
  assert.equal(salesSummary({ placed: [order('late', '2026-11-05T02:00:00Z', '20.00')], refunds: [], currency: 'USD', query: { period: 'today' }, now: evening }).orders, 1, 'in UTC it is Nov 5 too');
  assert.equal(salesSummary({ placed: [order('late', '2026-11-04T07:00:00Z', '20.00')], refunds: [], currency: 'USD', query: { period: 'today' }, now: evening, zone: LA }).orders, 0, '11 pm on Nov 3 in Los Angeles');
});

test('periods and the limits on custom ranges', () => {
  const week = resolvePeriod({ period: 'this_week' }, NOW); // Friday Nov 20 -> Monday Nov 16
  assert.equal(new Date(week.current.start).toISOString().slice(0, 10), '2026-11-16');
  const jan = resolvePeriod({ period: 'last_month' }, new Date('2026-01-10T00:00:00Z'));
  assert.equal(new Date(jan.current.start).toISOString().slice(0, 10), '2025-12-01', 'last month across a new year');
  assert.throws(() => resolvePeriod({ from: '2026-11-10', to: '2026-11-01' }, NOW), RangeError);
  assert.throws(() => resolvePeriod({ from: '2020-01-01', to: '2026-01-01' }, NOW), RangeError);
  assert.throws(() => resolvePeriod({ from: 'yesterday' }, NOW), RangeError);
  assert.ok(salesSummary({ placed, refunds, currency: 'USD', query: {}, now: NOW, partial: true }).notes.some((n) => /most recent/.test(n)));
});

test('a change from below zero is not read as a fall', () => {
  // October: no sales, one $20 refund (net -$20). November so far: $100.
  const s = salesSummary({ placed: [order('n', '2026-11-03T09:00:00Z', '100.00')], refunds: [refund(2_000, '2026-10-02T09:00:00Z', 'old')], currency: 'USD', query: {}, now: NOW });
  assert.equal(s.compared_with.net, '-$20.00');
  assert.equal(s.compared_with.change.net, 'up from below zero');
  assert.equal(change(-500, -2_000), 'up from below zero');
  assert.equal(change(-3_000, -2_000), 'down, still below zero');
  assert.equal(change(150, 100), '+50%');
});

test('days that do not exist are refused, not rolled into the next month', () => {
  assert.throws(() => resolvePeriod({ from: '2026-02-01', to: '2026-02-30' }, NOW), /no 2026-02-30/);
  assert.throws(() => resolvePeriod({ from: '2026-04-31' }, NOW), /no 2026-04-31/);
  assert.doesNotThrow(() => resolvePeriod({ from: '2028-02-29', to: '2028-02-29' }, NOW), 'a leap day is a day');
});

test('early in a period the estimate says how rough it is', () => {
  const early = salesSummary({ placed: [order('e', '2026-11-02T09:00:00Z', '50.00')], refunds: [], currency: 'USD', query: {}, now: new Date('2026-11-04T12:00:00Z') });
  assert.match(early.estimate!.note, /rough guess/);
});
