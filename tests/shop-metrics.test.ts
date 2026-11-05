// The Overview's numbers: this week against the one before, cancelled orders left out, the agents' week
// split by outcome, and the catalog's "sold in the last 14 days" counts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { soldSince } from '../src/core/catalog-view.ts';
import type { OrderSummary } from '../src/core/orders.ts';
import { change, shopMetrics } from '../src/core/shop-metrics.ts';
import { OPS_AGENT } from '../src/core/actors.ts';
import type { GuardRecord } from '../src/core/guard/types.ts';

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
    paidAt: `${day}T12:00:00Z`,
    createdAt: `${day}T12:00:00Z`,
    ...extra,
  };
}

function record(action: Partial<GuardRecord['action']>, status: GuardRecord['status'], at: string, events: GuardRecord['events'] = []): GuardRecord {
  return {
    id: `say_${at}_${status}`,
    createdAt: at,
    action: { kind: 'refund.create', actor: { type: 'agent', id: 'agent:x:k', side: 'merchant' }, ownerId: 'shop_x', currency: 'USD', reason: 'r', ...action } as GuardRecord['action'],
    status,
    idempotencyKey: 'k',
    events,
  };
}
const refund = (amount: number, verifiedAt: string) => record({ amount }, 'verified', verifiedAt, [{ at: verifiedAt, type: 'verified', by: 'sayso', hash: 'h' }]);
const asked = (actor: GuardRecord['action']['actor'], amount: number, status: GuardRecord['status'], at: string, approved = false) =>
  record({ actor, amount }, status, at, approved ? [{ at, type: 'approved', by: 'owner:shop_x', hash: 'h' }] : []);

test('this week against the week before: charged orders by when they were charged, refunds by when PayPal confirmed them', () => {
  const orders = [
    order('2026-11-04', 6000), // today
    order('2026-11-02', 4000),
    order('2026-10-29', 2000), // first day of this week
    order('2026-10-28', 3000), // last day of the week before
    order('2026-10-25', 5000, { status: 'released' }), // cancelled: not a sale
    order('2026-10-27', 8000, { status: 'awaiting_owner', paidAt: undefined }), // held, not charged: not a sale yet
    order('2026-10-01', 9000), // too old for either week
  ];
  // A $10 refund confirmed this week (on any order), and one from long ago.
  const m = shopMetrics(orders, [refund(1000, '2026-11-03T10:00:00Z'), refund(500, '2026-09-01T10:00:00Z')], NOW);

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

test("the agents' week: money by outcome in minor units, a buyer's checkout and older requests left out", () => {
  const agent = { type: 'agent' as const, id: 'agent:laptop:k1', side: 'merchant' as const };
  const records = [
    asked(agent, 500, 'verified', '2026-11-03T10:00:00Z'),
    asked(agent, 6050, 'pending_approval', '2026-11-02T10:00:00Z'),
    asked(agent, 25_000, 'denied', '2026-11-01T10:00:00Z'),
    asked(agent, 9900, 'verified', '2026-10-20T10:00:00Z', true), // two weeks ago
    asked(OPS_AGENT, 7000, 'verified', '2026-11-03T10:00:00Z'), // a buyer's own checkout: a sale, not a request
  ];
  const m = shopMetrics([], records, NOW);
  assert.deepEqual(m.sayso, { alone: 500, approved: 0, waiting: 6050, declined: 0, blocked: 25_000, requests: 3 });
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
