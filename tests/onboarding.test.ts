import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { openAICompatible } from '../src/core/ai/llm.ts';
import { draftCatalog, normalizeDraft } from '../src/core/ai/onboarding.ts';
import { draftPolicy, validateRules } from '../src/core/ai/policy-draft.ts';
import { evaluate } from '../src/core/guard/policy.ts';

/** A model that always answers with the given JSON and records what it was asked. */
function fakeModel(answer: unknown, seen: unknown[] = []): ChatModel {
  return {
    name: 'fake',
    async json(request) {
      seen.push(request);
      return structuredClone(answer);
    },
  };
}

const candleShop = {
  shop: { name: 'Lumen Candles', currency: 'usd', ships_from: 'US' },
  products: [
    {
      name: 'Soy Candle',
      description: 'Hand-poured, 8 oz.',
      category: 'home/decor',
      tags: ['candle', 'gift'],
      variants: [
        { title: 'Lavender', price: '18.00', quantity: 12, attributes: { scent: 'Lavender' } },
        { title: 'Cedar', price: 18, quantity: null, attributes: { scent: 'Cedar' } },
        { title: 'Mystery', price: null, quantity: 3 },
      ],
    },
    { name: 'Wax Melts', variants: [{ title: 'Sampler', price: '-5' }] },
  ],
  shipping: [{ name: 'USPS', countries: ['us'], price: '6.50', min_days: 2, max_days: 5 }],
  questions: ['Do you ship to Canada?'],
};

test('draft catalog: prices become cents, unknowns become questions, nothing is invented', async () => {
  const seen: unknown[] = [];
  const { catalog, questions } = await draftCatalog(fakeModel(candleShop, seen), { text: 'Lavender and cedar candles, $18 each', images: ['data:image/jpeg;base64,AAAA'] });

  assert.equal(catalog.shop.status, 'draft');
  assert.equal(catalog.shop.currency, 'USD');
  assert.match(catalog.shop.slug, /^lumen-candles-[0-9a-f]{4}$/);
  assert.equal(catalog.products.length, 1, 'products without a valid price are left out');

  const [lavender, cedar] = catalog.products[0].variants;
  assert.equal(lavender.price, 1_800);
  assert.equal(lavender.inventory, 12);
  assert.equal(cedar.price, 1_800);
  assert.equal(cedar.inventory, 1, 'unknown stock defaults to one piece, and asks');
  assert.equal(catalog.products[0].variants.length, 2, 'the unpriced variant is not for sale');

  assert.deepEqual(catalog.shop.shipping.map((s) => [s.countries, s.price]), [[['US'], 650]]);
  assert.ok(questions.includes('Do you ship to Canada?'));
  assert.ok(questions.some((q) => q.includes('Mystery') && q.includes('cost')));
  assert.ok(questions.some((q) => q.includes('Cedar') && q.includes('assumed 1')));

  // Photos are passed to the model; the seller's text is fenced as data.
  const request = seen[0] as { images?: string[]; user: string };
  assert.equal(request.images?.length, 1);
  assert.match(request.user, /"""\nLavender and cedar candles/);
});

test('draft catalog: no shipping info means a free domestic placeholder and a question', () => {
  const { catalog, questions } = normalizeDraft({ products: [{ name: 'Mug', variants: [{ title: 'Blue', price: '30', quantity: 2 }] }] }, { country: 'GB', currency: 'GBP' });
  assert.deepEqual(catalog.shop.shipping[0].countries, ['GB']);
  assert.equal(catalog.shop.shipping[0].price, 0);
  assert.ok(questions.some((q) => q.startsWith('Shipping is set to free')));
});

test('draft catalog: refuses when nothing sellable came back', () => {
  assert.throws(() => normalizeDraft({ products: [{ name: 'Thing', variants: [{ title: 'x', price: 'ask me' }] }] }), /No sellable products/);
});

test('draft catalog: duplicate names still get unique ids', () => {
  const { catalog } = normalizeDraft({
    products: [
      { name: 'Mug', variants: [{ title: 'Blue', price: '30' }] },
      { name: 'Mug', variants: [{ title: 'Blue', price: '32' }] },
    ],
  });
  const ids = catalog.products.flatMap((p) => [p.id, ...p.variants.map((v) => v.id)]);
  assert.equal(new Set(ids).size, ids.length);
});

test('policy draft: the model proposes, validation keeps only well-formed rules', async () => {
  const model = fakeModel({
    rules: [
      { type: 'max_amount', kinds: ['refund.create'], limit: '30', then: 'require_approval' },
      { type: 'never', kinds: ['dispute.accept'] },
      { type: 'max_amount', kinds: ['refund.create'], limit: 'lots' },
      { type: 'transfer_everything', kinds: ['refund.create'] },
      { type: 'always_approve', kinds: ['wire.transfer'] },
    ],
    unclear: ['be nice to regulars'],
  });
  const { policy, unclear } = await draftPolicy(model, 'shop_x', 'Refunds over $30 need my OK. Never accept disputes. Be nice to regulars.', 'USD');

  assert.deepEqual(policy.rules.map((r) => r.type), ['max_amount', 'never']);
  assert.equal(unclear.length, 4, 'one unclear phrase + three rejected rules, all reported back');
  assert.equal(policy.source, 'Refunds over $30 need my OK. Never accept disputes. Be nice to regulars.');

  const refund = { kind: 'refund.create' as const, actor: { type: 'agent' as const, id: 'a', side: 'merchant' as const }, ownerId: 'shop_x', amount: 4_000, currency: 'USD', reason: 'x' };
  assert.equal(evaluate(policy, refund, []).verdict, 'require_approval');
  assert.equal(evaluate(policy, { ...refund, amount: 2_000 }, []).verdict, 'allow');
});

test('policy draft: limits are parsed as money, never as floats', () => {
  const { rules } = validateRules([{ type: 'daily_total', kinds: ['refund.create'], limit: '$1,250.50', then: 'deny' }], 'USD');
  assert.deepEqual(rules[0], { id: 'rule-1', type: 'daily_total', kinds: ['refund.create'], limit: 125_050, then: 'deny' });
});

test('OpenAI-compatible client sends images as content parts and retries non-JSON once', async () => {
  const bodies: Record<string, any>[] = [];
  let calls = 0;
  const model = openAICompatible({
    apiKey: 'k',
    model: 'deepseek-flash',
    fetch: (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const content = ++calls === 1 ? 'Sure! Here it is.' : '```json\n{"ok":true}\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }) as typeof fetch,
  });
  assert.deepEqual(await model.json({ system: 's', user: 'u', images: ['data:image/png;base64,AA'] }), { ok: true });
  assert.equal(calls, 2);
  assert.equal(bodies[0].model, 'deepseek-flash');
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
  assert.equal(bodies[0].messages[1].content[1].type, 'image_url');
});
