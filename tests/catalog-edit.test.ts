// The owner edits a shop that is on sale: names, descriptions, each option's price and stock, shipping,
// and takes products off sale. Everything is checked before anything changes. Their agent can rename and
// describe too.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stack } from './stack.ts';

const variant = async (s: Awaited<ReturnType<typeof stack>>, id: string) => (await s.catalogs.byShopId('shop_maya'))!.products.flatMap((p) => p.variants).find((v) => v.id === id)!;

test('a product on sale is edited in one go, or not at all', async () => {
  const s = await stack();
  const mug = (await s.catalogs.byShopId('shop_maya'))!.products.find((p) => p.variants.some((v) => v.id === 'var_mug_sage'))!;

  // A bad price anywhere changes nothing, not even the name.
  await assert.rejects(s.shops.editProduct('shop_maya', mug.id, { name: 'Renamed', variants: [{ id: 'var_mug_sage', price: 'cheap' }] }), /write a price/);
  assert.equal((await s.shops.get('shop_maya')).products.find((p) => p.id === mug.id)!.name, mug.name);

  await s.shops.editProduct('shop_maya', mug.id, { name: '  Sage   Mug ', description: 'Hand-thrown, 12 oz.', variants: [{ id: 'var_mug_sage', title: 'Sage', price: '36.50', inventory: 9 }] });
  const after = (await s.shops.get('shop_maya')).products.find((p) => p.id === mug.id)!;
  assert.equal(after.name, 'Sage Mug');
  assert.equal(after.description, 'Hand-thrown, 12 oz.');
  const v = await variant(s, 'var_mug_sage');
  assert.deepEqual([v.title, v.price, v.inventory], ['Sage', 3650, 9]);

  await assert.rejects(s.shops.editProduct('shop_maya', mug.id, { variants: [{ id: 'var_mug_sage', inventory: -1 }] }), /stock/);
  await assert.rejects(s.shops.editProduct('shop_maya', mug.id, { variants: [{ id: 'var_someone_elses', price: '1.00' }] }), /not found/i);
  await assert.rejects(s.shops.editProduct('shop_maya', 'prod_nope', { name: 'x y' }), /not found/i);
});

test('taking a product off sale, but never the last one', async () => {
  const s = await stack();
  const ids = (await s.shops.get('shop_maya')).products.map((p) => p.id);
  for (const id of ids.slice(1)) await s.shops.removeProduct('shop_maya', id);
  assert.deepEqual((await s.shops.get('shop_maya')).products.map((p) => p.id), [ids[0]]);
  await assert.rejects(s.shops.removeProduct('shop_maya', ids[0]), /at least one product/);
});

test('shipping prices and free shipping above', async () => {
  const s = await stack();
  const [rule] = (await s.shops.get('shop_maya')).shop.shipping;
  await s.shops.editShipping('shop_maya', [{ id: rule.id, price: '6.00', freeAbove: '50.00' }]);
  let now = (await s.shops.get('shop_maya')).shop.shipping[0];
  assert.deepEqual([now.price, now.freeAbove], [600, 5000]);
  await s.shops.editShipping('shop_maya', [{ id: rule.id, freeAbove: '' }]);
  now = (await s.shops.get('shop_maya')).shop.shipping[0];
  assert.equal(now.freeAbove, undefined, 'an empty threshold means no free shipping');
  await assert.rejects(s.shops.editShipping('shop_maya', [{ id: rule.id, price: 'free-ish' }]), /amount/);
});

test("the owner's agent can rename and describe a product", async () => {
  const s = await stack();
  const mug = (await s.catalogs.byShopId('shop_maya'))!.products[0];
  const out = await s.call('update_product', { product_id: mug.id, name: 'Morning Mug', description: 'Fits two hands.' }, s.owner);
  assert.equal(out.isError, false, out.text);
  assert.equal(out.data.name, 'Morning Mug');
  assert.equal((await s.call('update_product', { product_id: mug.id }, s.owner)).isError, true, 'something to change');
  assert.equal((await s.call('update_product', { product_id: mug.id, name: 'x y' }, s.buyer)).isError, true, "a buyer's assistant can't");
});
