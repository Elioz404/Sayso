// The Overview's numbers: this week against the one before, cancelled orders left out, the agents' week
// split by outcome, and the catalog's "sold in the last 14 days" counts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { soldSince } from '../src/core/catalog-view.ts';
import type { OrderSummary } from '../src/core/orders.ts';
import { change, shopMetrics } from '../src/core/shop-metrics.ts';
import type { DecisionRow } from '../src/core/trust-report.ts';

const NOW = new Date('2026-11-04T15:00:00Z');

let n = 0;
function order(day: string, totalMinor: number, extra: Partial<OrderSummary> = {}): OrderSummary {
  n += 1;
  return {
    id: `cart_${n}`,
    number: `SAY-${n}`,
    status: 'paid',
    currency: 'USD',
    totalMinor,
    items: [{ variant_id: 'var_mug_sage', quantity: 1 }],
    paidToOwner: true,
    refundedMinor: 0,
    createdAt: `${day}T12:00:00Z`,
    ...extra,
  };
}

function decision(day: string, money: Partial<DecisionRow>): DecisionRow {
  return { id: day, day, action: 'Refund', who: 'Your agents', outcome: 'Allowed by your rules', amount: 0, movedAlone: 0, approved: 0, waiting: 0, declined: 0, blocked: 0, requests: 1, nAlone: 0, nApproved: 0, nWaiting: 0, nDeclined: 0, nBlocked: 0, ...money } as DecisionRow;
}

test('this week against the week before, with a sparkline per number', () => {
  const orders = [
    order('2026-11-04', 6000), // today
    order('2026-11-02', 4000, { refundedMinor: 1000 }),
    order('2026-10-29', 2000), // first day of this week
    order('2026-10-28', 3000), // last day of the week before
    order('2026-10-25', 5000, { status: 'released' }), // cancelled: not a sale
    order('2026-10-01', 9000), // too old for either week
    { ...order('2026-11-03', 7000), number: undefined }, // a cart, never placed
  ];
  const m = shopMetrics(orders, [], 100, NOW);

  assert.equal(m.daily.length, 14);
  assert.equal(m.daily[0].day, '2026-10-22');
  assert.equal(m.daily.at(-1)!.day, '2026-11-04');
  assert.deepEqual(m.revenue, { now: 12_000, before: 3000, series: [2000, 0, 0, 0, 4000, 0, 6000] });
  assert.equal(m.orders.now, 3);
  assert.equal(m.orders.before, 1);
  assert.equal(m.average.now, 4000);
  assert.equal(m.average.before, 3000);
  assert.equal(m.refundRate.now, 833, '1,000 of 12,000 refunded is 8.33%');
  assert.equal(m.refundRate.before, 0);
  assert.equal(m.average.series.length, 7);
  assert.equal(m.average.series.at(-1), m.average.now, "the running average ends on this week's number");
});

test("the agents' week: money by outcome, older requests left out", () => {
  const decisions = [
    decision('2026-11-03', { movedAlone: 5 }),
    decision('2026-11-02', { waiting: 60.5 }),
    decision('2026-11-01', { blocked: 250 }),
    decision('2026-10-20', { approved: 99 }), // two weeks ago
  ];
  const m = shopMetrics([], decisions, 100, NOW);
  assert.deepEqual(m.sayso, { alone: 500, approved: 0, waiting: 6050, declined: 0, blocked: 25_000, requests: 3 });
  assert.equal(shopMetrics([], decisions, 1, NOW).sayso.waiting, 61, 'currencies without cents round to whole units');
});

test('change is a whole percentage, and says nothing when there was nothing before', () => {
  assert.equal(change({ now: 150, before: 100 }), 50);
  assert.equal(change({ now: 50, before: 200 }), -75);
  assert.equal(change({ now: 0, before: 0 }), 0);
  assert.equal(change({ now: 10, before: 0 }), undefined);
});

test('sold in the last 14 days counts placed orders only, per variant', () => {
  const since = new Date('2026-10-21T00:00:00Z');
  const sold = soldSince(
    [
      order('2026-11-01', 0, { items: [{ variant_id: 'var_a', quantity: 2 }, { variant_id: 'var_b', quantity: 1 }] }),
      order('2026-10-30', 0, { items: [{ variant_id: 'var_a', quantity: 3 }] }),
      order('2026-10-29', 0, { status: 'released', items: [{ variant_id: 'var_a', quantity: 10 }] }),
      order('2026-10-01', 0, { items: [{ variant_id: 'var_b', quantity: 4 }] }),
      { ...order('2026-11-02', 0, { items: [{ variant_id: 'var_c', quantity: 1 }] }), number: undefined },
    ],
    since,
  );
  assert.deepEqual(Object.fromEntries(sold), { var_a: 5, var_b: 1 });
});
