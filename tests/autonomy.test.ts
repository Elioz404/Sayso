import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPROVALS_NEEDED, earnedAutonomy } from '../src/core/guard/autonomy.ts';
import { defaultMerchantPolicy, evaluate } from '../src/core/guard/policy.ts';
import type { GuardRecord } from '../src/core/guard/types.ts';

const SHOP = 'shop_test';
const policy = defaultMerchantPolicy(SHOP, 'USD'); // refunds over $50 need the owner
const now = new Date('2026-11-04T12:00:00Z');
let n = 0;

/** A refund an agent asked for, held by refund-cap, then decided by `by`. */
function decided(amount: number, decision: 'approved' | 'rejected', by = `owner:${SHOP}`, daysAgo = 1, actor: 'agent' | 'human' = 'agent'): GuardRecord {
  const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `rec_${++n}`,
    createdAt: at,
    action: { kind: 'refund.create', actor: { type: actor, id: 'agent:helper:key_1', side: 'merchant' }, ownerId: SHOP, amount, currency: 'USD', reason: 'Broken in transit' },
    decision: { verdict: 'require_approval', hits: [{ ruleId: 'refund-cap', verdict: 'require_approval', message: 'over' }] },
    status: decision === 'approved' ? 'verified' : 'rejected',
    idempotencyKey: `k${n}`,
    events: [{ at, type: decision, by, hash: 'h' }],
  };
}

test('three approvals of held refunds earn a higher limit, rounded up and explained', () => {
  const { suggestions } = earnedAutonomy(policy, [decided(5500, 'approved'), decided(8200, 'approved'), decided(6400, 'approved')], now);
  assert.equal(suggestions.length, 1);
  const [s] = suggestions;
  assert.equal(s.from, 5000);
  assert.equal(s.to, 9000);
  assert.match(s.title, /refunds up to \$90\.00/);
  assert.match(s.evidence, /approved 3 refunds from \$55\.00 to \$82\.00/);

  // The new policy really lets a $85 refund through and still holds $95.
  const action = (amount: number) => ({ kind: 'refund.create' as const, actor: { type: 'agent' as const, id: 'a', side: 'merchant' as const }, ownerId: SHOP, amount, reason: 'x' });
  assert.equal(evaluate(s.policy, action(8500), [], now).verdict, 'allow');
  assert.equal(evaluate(s.policy, action(9500), [], now).verdict, 'require_approval');
  // Other rules are untouched.
  assert.deepEqual(s.policy.rules.filter((r) => r.id !== 'refund-cap'), policy.rules.filter((r) => r.id !== 'refund-cap'));
});

test('nothing is suggested before enough approvals, and the progress says how far along it is', () => {
  const { suggestions, learning } = earnedAutonomy(policy, [decided(5500, 'approved'), decided(6000, 'approved')], now);
  assert.equal(suggestions.length, 0);
  assert.deepEqual(learning.find((l) => l.ruleId === 'refund-cap'), { ruleId: 'refund-cap', kind: 'refund.create', approvals: 2, rejections: 0, needed: APPROVALS_NEEDED });
});

test('a limit never rises to or past anything the owner turned down', () => {
  const history = [decided(5500, 'approved'), decided(6000, 'approved'), decided(6200, 'approved'), decided(6500, 'rejected'), decided(9000, 'approved')];
  const [s] = earnedAutonomy(policy, history, now).suggestions;
  assert.equal(s.to, 6200); // rounding up to $70 would pass the $65 rejection, so the highest approval
  assert.match(s.evidence, /turned down 1 bigger one/);
});

test('only the owner\'s decisions on agent requests, from the last 30 days, count', () => {
  const history = [
    decided(5500, 'approved'),
    decided(6000, 'approved', 'system:sweeper'),
    decided(6200, 'approved', `owner:${SHOP}`, 45),
    decided(6300, 'approved', `owner:${SHOP}`, 1, 'human'),
  ];
  assert.equal(earnedAutonomy(policy, history, now).suggestions.length, 0);
});

test('a suggestion already in force is not suggested again', () => {
  const history = [decided(5500, 'approved'), decided(8200, 'approved'), decided(6400, 'approved')];
  const [s] = earnedAutonomy(policy, history, now).suggestions;
  assert.equal(earnedAutonomy(s.policy, history, now).suggestions.length, 0);
});
