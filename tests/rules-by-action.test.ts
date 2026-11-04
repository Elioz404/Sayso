// The Rules page reads a shop's rules per action: what an agent does alone, what waits, what is blocked.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultMerchantPolicy, type Policy } from '../src/core/guard/policy.ts';
import { rulesByAction } from '../src/core/guard/rules-by-action.ts';

test("a new shop's default rules, per action", () => {
  const rows = rulesByAction(defaultMerchantPolicy('shop_x', 'USD'));
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Refunds', 'Invoices', 'Charging paid orders', 'Rule changes'],
  );
  assert.equal(by.Refunds.alone, 'Up to $50.00');
  assert.deepEqual(by.Refunds.ask, ['Over $50.00', 'More than $200.00 in 24 hours']);
  assert.deepEqual(by.Refunds.block, ['The same one again within 60 minutes']);
  assert.equal(by.Invoices.alone, 'Up to $200.00');
  assert.deepEqual(by.Invoices.ask, ['Over $200.00', 'To someone who has never paid you']);
  assert.equal(by['Charging paid orders'].alone, 'Any amount');
  assert.deepEqual(by['Charging paid orders'].ask, []);
  assert.equal(by['Rule changes'].alone, 'Never');
});

test('blocked limits, owner-only actions and payment holds', () => {
  const policy: Policy = {
    ownerId: 'shop_x',
    currency: 'EUR',
    rules: [
      { id: 'big', type: 'max_amount', kinds: ['refund.create'], limit: 50_000, then: 'deny' },
      { id: 'ask', type: 'max_amount', kinds: ['refund.create'], limit: 3_000, then: 'require_approval' },
      { id: 'caps', type: 'always_approve', kinds: ['payment.capture'] },
      { id: 'voids', type: 'never', kinds: ['payment.void'] },
    ],
  };
  const by = Object.fromEntries(rulesByAction(policy).map((r) => [r.kind, r]));
  assert.equal(by['refund.create'].alone, 'Up to €30.00', 'the lowest limit is where acting alone stops');
  assert.deepEqual(by['refund.create'].ask, ['Over €30.00']);
  assert.deepEqual(by['refund.create'].block, ['Over €500.00']);
  assert.equal(by['payment.capture'].alone, 'Never');
  assert.deepEqual(by['payment.capture'].ask, ['Every one']);
  assert.deepEqual(by['payment.void'].block, ['Every one'], 'holds show up once a rule is about them');
  assert.deepEqual(by['invoice.send'].ask, []);
  assert.equal(by['invoice.send'].alone, 'Any amount');
});
