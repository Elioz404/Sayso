// Product search, as shoppers and their assistants phrase it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { parseWords, productQuery, searchCatalog } from '../src/core/search.ts';

const names = (query: string, extra: { max_price?: string; in_stock_only?: boolean } = {}) =>
  searchCatalog(demoCatalog, productQuery(demoCatalog, { query, ...extra })).map((p) => p.name);

test('filler words, prices and plurals do not get in the way', () => {
  assert.deepEqual(parseWords('A gift for my sister: two MUGS under $40'), ['two', 'mug']);
  assert.ok(names('mugs').includes('Hand-thrown Mug'));
});

test("the trade's synonyms find the right pieces", () => {
  assert.ok(names('handmade pottery').length > 0, 'pottery finds a ceramics shop');
  assert.deepEqual(names('ceramic cup'), ['Hand-thrown Mug']);
  assert.ok(names('stoneware bowls').includes('Ramen Bowl'));
});

test('every word counts first; the closest pieces come back rather than nothing', () => {
  assert.deepEqual(names('sage mug'), ['Hand-thrown Mug']);
  assert.deepEqual(names('mug teapot'), ['Hand-thrown Mug'], 'one of two words is still worth showing');
  assert.deepEqual(names('teapot'), []);
});

test('price and stock filters still apply', () => {
  assert.ok(!names('pottery', { max_price: '40.00' }).includes('Ramen Bowl'));
  assert.deepEqual(names('', {}).length, demoCatalog.products.length, 'an empty query lists everything');
});
