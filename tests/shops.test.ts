// The shops directory and the "Buy with AI" links into the shopping assistant.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { assistantLink, assistantPrompt, shopCard } from '../src/core/storefront.ts';

test('a shop card says what the shop sells and for how much', () => {
  const card = shopCard(demoCatalog);
  assert.equal(card.slug, 'maya-ceramics');
  assert.equal(card.products, demoCatalog.products.length);
  assert.ok(card.kinds.length > 0 && card.kinds.every((k) => /^[A-Z]/.test(k) && !k.includes('/')), 'categories read as words');
  const prices = demoCatalog.products.flatMap((p) => p.variants.map((v) => v.price));
  assert.equal(card.from, Math.min(...prices));
  assert.equal(card.to, Math.max(...prices));
});

test('"Buy with AI" opens the assistant with a request for something in stock', () => {
  const mug = demoCatalog.products.find((p) => p.name.includes('Mug'))!;
  const request = assistantPrompt(demoCatalog, mug);
  assert.match(request, /Mug from Maya Ceramics/);
  const link = assistantLink(request);
  assert.ok(link.startsWith('/assistant?ask='));
  assert.equal(new URL(link, 'https://x').searchParams.get('ask'), request);
});

test('assistants may name a shop the way people write it', async () => {
  const { shopSlugOf } = await import('../src/core/tools/context.ts');
  assert.equal(shopSlugOf('maya_ceramics'), 'maya-ceramics');
  assert.equal(shopSlugOf(' Maya Ceramics '), 'maya-ceramics');
  assert.equal(shopSlugOf('maya-ceramics'), 'maya-ceramics');
});

test('search results carry each product page and photo, so a buyer can see and open them', async () => {
  const { stack } = await import('./stack.ts');
  const s = await stack();
  const { data } = await s.call('search_products', { query: 'mug' }, { marketplace: true });
  const mug = data.results[0].products[0];
  assert.match(mug.url, /\/shop\/maya-ceramics\//);
  assert.ok(!mug.image || /^https?:\/\//.test(mug.image), 'photos are absolute URLs');
});
