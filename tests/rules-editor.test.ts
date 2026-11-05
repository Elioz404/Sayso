// The owner changes the rules in their own words: drafted first (nothing changes), saved when they say so,
// through Guard and its audit like any rule change.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownerActor } from '../src/core/actors.ts';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { defaultMerchantPolicy } from '../src/core/guard/policy.ts';
import { rulesByAction } from '../src/core/guard/rules-by-action.ts';
import { stack } from './stack.ts';

const model: ChatModel = {
  name: 'fake',
  json: async () => ({
    rules: [
      { type: 'max_amount', kinds: ['refund.create'], limit: '30', then: 'require_approval' },
      { type: 'new_counterparty', kinds: ['invoice.send'], then: 'require_approval' },
    ],
    unclear: ['be nice to regulars'],
  }),
};

test('the owner drafts rules, reads them, then saves them', async () => {
  const s = await stack(model);
  const words = 'Refunds over $30 need my OK. Invoices to new clients always need my OK. Be nice to regulars.';

  const { policy, unclear, token } = await s.saySo.draftRules('shop_maya', words);
  assert.deepEqual(unclear, ['be nice to regulars'], 'what did not become a rule is said, not dropped');
  assert.equal((await s.saySo.policy('shop_maya')).rules[0].id, 'refund-cap', 'a draft changes nothing');
  assert.equal(rulesByAction(policy)[0].alone, 'Up to $30.00');

  const saved = await s.saySo.saveRules('shop_maya', token, ownerActor('shop_maya'));
  assert.equal(saved.status, 'verified', "the owner's own change applies at once");
  assert.equal(saved.action.kind, 'policy.update');
  assert.equal(saved.action.reason, `New rules: "${words}"`);
  const now = await s.saySo.policy('shop_maya');
  assert.deepEqual(rulesByAction(now)[0].ask, ['Over $30.00']);
  assert.equal(now.source, words);

  // A draft is saved only as it was signed, only in its own shop, and only if no rules changed since it was drafted.
  await assert.rejects(s.saySo.saveRules('shop_maya', token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), ownerActor('shop_maya')), /draft it again/);
  await assert.rejects(s.saySo.saveRules('shop_other', token, ownerActor('shop_other')), /another shop/);
  const stale = await s.saySo.draftRules('shop_maya', words);
  await s.saySo.submitPolicy(defaultMerchantPolicy('shop_maya', 'USD'), 'Back to the defaults', ownerActor('shop_maya'));
  assert.equal((await s.saySo.saveRules('shop_maya', stale.token, ownerActor('shop_maya'))).status, 'denied', 'written against rules that have since changed');
});

test('an agent proposing rules still waits for the owner', async () => {
  const s = await stack(model);
  const proposed = await s.call('propose_policy', { rules: 'Refunds over $30 need my OK' }, s.owner);
  assert.equal(proposed.data.status, 'pending_approval');
  assert.equal((await s.saySo.policy('shop_maya')).rules[0].id, 'refund-cap');
});
