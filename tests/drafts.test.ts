import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Access, MemoryAccessStore } from '../src/core/access.ts';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { pricesToConfirm } from '../src/core/catalog.ts';
import { links } from '../src/core/links.ts';
import { MarketPrices, type Listing } from '../src/core/market.ts';
import { MemoryMediaStore } from '../src/core/media.ts';
import { PayPalClient } from '../src/core/paypal/client.ts';
import { Shops } from '../src/core/shops.ts';
import { MemoryCatalogStore } from '../src/core/stores.ts';
import { fakePayPal } from './fake-paypal.ts';

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
/** What a model sees in one photo of a mug and no notes: everything but the price. */
const fromPhoto: ChatModel = {
  name: 'fake',
  json: async () => ({
    shop: { name: 'Clay Corner' },
    products: [{ name: 'Stoneware mug', description: 'Speckled white, 12 oz.', category: 'home/kitchen', tags: ['mug'], photo: 1, variants: [{ title: 'Speckled white', price: null, quantity: 4 }] }],
  }),
};
const listings = (prices: number[]): Listing[] => prices.map((price, i) => ({ title: `Mug ${i}`, store: `store${i}.com`, price, currency: 'USD', url: 'https://example.com' }));

function setup(prices: number[] | undefined) {
  const media = new MemoryMediaStore();
  const catalogs = new MemoryCatalogStore();
  const market = prices && new MarketPrices({ search: async () => listings(prices) });
  const paypal = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: fakePayPal().fetch });
  const shops = new Shops({ catalogs, access: new Access(new MemoryAccessStore(), 'test-session-secret-0123456789'), paypal, model: fromPhoto, links: links('https://sayso.test'), media, market });
  return { shops, media };
}

test('from one photo: the product keeps it, and its price starts at what similar items sell for', async () => {
  const { shops, media } = setup([2_800, 3_200, 3_600, 4_000, 4_500]);
  const { catalog, questions } = await shops.onboard({ images: [PHOTO] }, 'laptop', { ownerSecret: false });
  const [product] = catalog.products;

  assert.match(product.imageUrl ?? '', /^\/media\/med_[0-9a-f]{18}$/);
  const stored = await media.get(product.imageUrl!.split('/').pop()!);
  assert.equal(stored?.type, 'image/jpeg');

  const [variant] = product.variants;
  assert.equal(variant.price, 3_600, 'the median of similar listings');
  assert.deepEqual(variant.priceToConfirm, { suggested: { low: 3_200, median: 3_600, high: 4_000, listings: 5 } });
  assert.deepEqual(
    questions.filter((q) => q.includes('Stoneware mug')),
    ['Stoneware mug (Speckled white): similar items sell for $32.00 to $40.00 (5 listings), so Sayso put $36.00. Keep it or set your own before publishing.'],
    'one question per product, the suggestion instead of a plain ask',
  );
});

test('a suggested price is never published on its own: the owner confirms it first', async () => {
  const { shops } = setup([2_800, 3_200, 3_600]);
  const { catalog } = await shops.onboard({ images: [PHOTO] }, 'laptop', { ownerSecret: false });
  const variantId = catalog.products[0].variants[0].id;

  await assert.rejects(shops.publish(catalog.shop.id), /Confirm the price of Stoneware mug \(Speckled white\)/);
  await shops.setVariant(catalog.shop.id, variantId, { price: '32.00' }); // keeping the suggestion would confirm it too
  assert.deepEqual(pricesToConfirm(await shops.get(catalog.shop.id)), []);
  assert.equal((await shops.publish(catalog.shop.id)).catalog.shop.status, 'live');
});

test('without enough market data the price stays empty and still waits for the owner', async () => {
  for (const prices of [undefined, [3_000]]) {
    const { shops } = setup(prices);
    const { catalog, questions } = await shops.onboard({ images: [PHOTO] }, 'laptop', { ownerSecret: false });
    assert.deepEqual([catalog.products[0].variants[0].price, catalog.products[0].variants[0].priceToConfirm], [0, {}]);
    assert.ok(questions.includes('What does Stoneware mug (Speckled white) cost? Set a price before publishing.'));
  }
});

test("the owner's review of a draft: edits, prices kept or changed are confirmed, then it publishes", async () => {
  const { shops } = setup([2_800, 3_200, 3_600]);
  const { catalog, agentKey } = await shops.onboard({ images: [PHOTO] }, 'laptop', { ownerSecret: false, agentKey: false });
  assert.equal(agentKey, undefined, 'the web flow connects an agent later');
  const shopId = catalog.shop.id;
  const [product] = catalog.products;
  const [variant] = product.variants;
  const [rule] = catalog.shop.shipping;

  // A bad amount changes nothing at all.
  await assert.rejects(shops.reviewDraft(shopId, { shopName: 'Clay Corner & Co', products: [{ id: product.id, variants: [{ id: variant.id, price: 'cheap' }] }] }), /write an amount like 24.50/);
  assert.equal((await shops.get(shopId)).shop.name, 'Clay Corner');
  await assert.rejects(shops.reviewDraft(shopId, { products: [{ id: product.id, remove: true }] }), /Keep at least one piece/);

  // Keeping the suggested price ($36.00) is the owner's confirmation; stock and names are theirs too.
  const reviewed = await shops.reviewDraft(shopId, {
    shopName: '  Clay   Corner Studio ',
    products: [{ id: product.id, name: 'Speckled stoneware mug', description: 'Wheel-thrown, 12 oz.', variants: [{ id: variant.id, price: '36', inventory: 6 }] }],
    shipping: [{ id: rule.id, price: '7.50', freeAbove: '60' }],
  });
  assert.equal(reviewed.shop.name, 'Clay Corner Studio');
  const edited = reviewed.products[0];
  assert.deepEqual([edited.name, edited.description, edited.variants[0].price, edited.variants[0].inventory, edited.variants[0].priceToConfirm], ['Speckled stoneware mug', 'Wheel-thrown, 12 oz.', 3_600, 6, undefined]);
  assert.deepEqual([reviewed.shop.shipping[0].price, reviewed.shop.shipping[0].freeAbove], [750, 6_000]);
  assert.deepEqual(pricesToConfirm(reviewed), []);

  // Free shipping above can be taken away; once live, the draft can't be edited from here.
  assert.equal((await shops.reviewDraft(shopId, { shipping: [{ id: rule.id, freeAbove: '' }] })).shop.shipping[0].freeAbove, undefined);
  assert.equal((await shops.publish(shopId)).catalog.shop.status, 'live');
  await assert.rejects(shops.reviewDraft(shopId, { shopName: 'Another name' }), /already live/);
});
