// Limits that keep one caller from costing everyone: the AI budget, Guard's history, cart sizes, and
// how many PayPal reads run at once.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Budget, LlmError, MemorySpendStore, openAICompatible } from '../src/core/ai/llm.ts';
import { parseCartInput } from '../src/core/cart/input.ts';
import { BoundedCache, mapLimit } from '../src/core/concurrency.ts';
import { Guard, MemoryGuardStore } from '../src/core/guard/engine.ts';
import { defaultMerchantPolicy } from '../src/core/guard/policy.ts';
import type { Executor, GuardRecord } from '../src/core/guard/types.ts';
import { RateLimit } from '../src/core/rate-limit.ts';

test('the AI budget survives a restart and calls running at once cannot all slip under it', async () => {
  const spend = new MemorySpendStore();
  // $1 per million tokens; each call reports 300k tokens = $0.30 and may reserve up to ~$0.003.
  const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 200_000, completion_tokens: 100_000 } }), { status: 200 });
  const make = () => openAICompatible({ provider: 'openai', apiKey: 'k', budget: new Budget(0.5, 1, 1, spend), fetch: (async () => reply()) as typeof fetch });

  await make().json({ system: 's', user: 'u' });
  await make().json({ system: 's', user: 'u' }); // a "restarted" server, same store: $0.60 spent
  await assert.rejects(make().json({ system: 's', user: 'u' }), (e: LlmError) => e.status === 429);

  // Reservations: with $0.003 room left, two calls started together, only one gets through.
  const tight = new Budget(0.0035, 1, 1, new MemorySpendStore());
  const first = await tight.reserve(1_200);
  await assert.rejects(tight.reserve(1_200), /budget/);
  await tight.settle(first, undefined); // the call failed: its hold is released, nothing recorded
  assert.ok(await tight.reserve(1_200));
});

test('a JSON retry sends the model its own answer, not the photos again', async () => {
  const bodies: { messages: { role: string; content: unknown }[] }[] = [];
  let n = 0;
  const model = openAICompatible({
    provider: 'openai',
    apiKey: 'k',
    fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const content = n++ === 0 ? 'Here you go: {"ok": tru' : '{"ok":true}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.deepEqual(await model.json({ system: 's', user: 'u', images: ['data:image/png;base64,AA'] }), { ok: true });
  assert.ok(Array.isArray(bodies[0].messages[1].content), 'the first call carries the photo');
  assert.equal(bodies[1].messages[1].content, 'u', 'the retry does not');
  assert.equal(bodies[1].messages[2].role, 'assistant');
});

test("when a shop's recent activity is more than Guard reads at once, the owner decides", async () => {
  const store = new MemoryGuardStore();
  const ok: Executor = { simulate: async () => ({ ok: true, effects: [], blockers: [] }), execute: async () => ({}), verify: async () => ({ ok: true, detail: 'ok' }) };
  const guard = new Guard({ store, executors: { 'refund.create': ok }, policyFor: async () => defaultMerchantPolicy('shop_busy', 'USD') });
  const now = new Date().toISOString();
  for (let i = 0; i < 2_000; i++) {
    await store.insert({ id: `say_${i}`, createdAt: now, action: { kind: 'invoice.send', actor: { type: 'human', id: 'owner', side: 'merchant' }, ownerId: 'shop_busy', amount: 1, reason: 'x', resourceId: `r${i}` }, status: 'verified', idempotencyKey: `k${i}`, events: [] } as GuardRecord);
  }
  const record = await guard.submit({ kind: 'refund.create', actor: { type: 'agent', id: 'a', side: 'merchant' }, ownerId: 'shop_busy', amount: 100, currency: 'USD', reason: 'small', resourceId: 'cap_1' });
  assert.equal(record.status, 'pending_approval');
  assert.ok(record.decision?.hits.some((h) => h.ruleId === 'built-in:busy'));
});

test('cart bodies are checked once for every caller: bounded lines and fields', () => {
  assert.deepEqual(parseCartInput({ items: [{ variant_id: 'var_mug_sage', quantity: 1 }] }).items.length, 1);
  assert.deepEqual(parseCartInput({}).items, [], 'a checkout sends no lines');
  const many = { items: Array.from({ length: 21 }, (_, i) => ({ variant_id: `v${i}`, quantity: 1 })) };
  assert.throws(() => parseCartInput(many), { status: 400 });
  assert.throws(() => parseCartInput({ items: [{ variant_id: 'x'.repeat(81), quantity: 1 }] }), { status: 400 });
  assert.throws(() => parseCartInput('not a cart'), { status: 400 });
});

test('PayPal reads run a few at a time, in order; caches and limits do not grow forever', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 2));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70, 80]);
  assert.equal(peak, 3);

  const cache = new BoundedCache<string, number>(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), undefined, 'the oldest went');
  assert.equal(cache.get('c'), 3);

  const limit = new RateLimit(1, 1_000, 3);
  for (const key of ['a', 'b', 'c', 'd']) assert.equal(limit.allow(key, 0), true);
  assert.equal(limit.allow('a', 10), false, 'still inside its window');
  assert.equal(limit.allow('a', 2_000), true, 'a new window');
});
