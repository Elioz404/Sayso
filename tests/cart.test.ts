import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPayable, priceCart } from '../src/core/cart/engine.ts';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { toMinor } from '../src/core/money.ts';

const portland = { country_code: 'US', admin_area_1: 'OR', admin_area_2: 'Portland', postal_code: '97214' };
const now = new Date('2026-11-10T12:00:00Z');

test('valid cart is priced from the catalog, with free ground shipping over $75', () => {
  const cart = priceCart(
    demoCatalog,
    { items: [{ variant_id: 'var_mug_sage', quantity: 1 }, { variant_id: 'var_bowl_sand', quantity: 1 }], shipping_address: portland },
    { mode: 'create', now },
  );
  assert.equal(cart.status, 'CREATED');
  assert.equal(cart.validation_status, 'VALID');
  assert.deepEqual(cart.validation_issues, []);
  assert.equal(cart.totals?.subtotal?.value, '82.00');
  assert.equal(cart.totals?.shipping?.value, '0.00'); // ground is free above $75 and cheapest
  assert.equal(cart.totals?.tax?.value, '0.00'); // Oregon has no sales tax
  assert.equal(cart.totals?.total.value, '82.00');
  assert.equal(cart.available_shipping_options?.find((o) => o.is_selected)?.id, 'us-ground');
  assert.ok(isPayable(cart));
});

test('state tax is more specific than country tax', () => {
  const cart = priceCart(
    demoCatalog,
    { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: { country_code: 'US', admin_area_1: 'CA' } },
    { mode: 'update', now },
  );
  assert.equal(cart.status, 'READY');
  assert.equal(toMinor(cart.totals!.tax!), 247); // 7.25% of $34.00 = $2.465, rounded half-up
});

test('over-stock request returns INVENTORY_ISSUE with reduce + alternative options', () => {
  const cart = priceCart(demoCatalog, { items: [{ variant_id: 'var_mug_speckled', quantity: 2 }], shipping_address: portland }, { mode: 'create', now });
  assert.equal(cart.status, 'INCOMPLETE');
  assert.equal(cart.validation_status, 'INVALID');
  const issue = cart.validation_issues![0];
  assert.equal(issue.code, 'INVENTORY_ISSUE');
  const actions = issue.resolution_options!.map((o) => o.action);
  assert.deepEqual(actions, ['REDUCE_QUANTITY', 'REPLACE_VARIANT', 'REMOVE_ITEM']);
  assert.equal(issue.resolution_options![1].metadata?.variant_id, 'var_mug_sage');
  assert.ok(!isPayable(cart));
});

test('made-to-order variants are never out of stock', () => {
  const cart = priceCart(demoCatalog, { items: [{ variant_id: 'var_vase_custom', quantity: 3 }], shipping_address: portland }, { mode: 'create', now });
  assert.deepEqual(cart.validation_issues, []);
});

test('stale price quoted by the agent is flagged', () => {
  const cart = priceCart(
    demoCatalog,
    { items: [{ variant_id: 'var_mug_sage', quantity: 1, price: { currency_code: 'USD', value: '30.00' } }], shipping_address: portland },
    { mode: 'create', now },
  );
  assert.equal(cart.validation_issues![0].code, 'PRICING_ERROR');
  assert.equal(cart.items[0].price?.value, '34.00');
});

test('missing address asks for more information; unsupported country is a business rule', () => {
  const noAddress = priceCart(demoCatalog, { items: [{ variant_id: 'var_mug_sage', quantity: 1 }] }, { mode: 'create', now });
  assert.equal(noAddress.validation_status, 'REQUIRES_ADDITIONAL_INFORMATION');

  const brazil = priceCart(demoCatalog, { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: { country_code: 'BR' } }, { mode: 'create', now });
  assert.equal(brazil.validation_issues![0].code, 'SHIPPING_ERROR');
  assert.equal(brazil.validation_issues![0].type, 'BUSINESS_RULE');
});

test('international shipping is offered to listed countries', () => {
  const cart = priceCart(demoCatalog, { items: [{ variant_id: 'var_bowl_sand', quantity: 1 }], shipping_address: { country_code: 'JP' } }, { mode: 'create', now });
  assert.deepEqual(cart.validation_issues, []);
  assert.equal(cart.totals?.shipping?.value, '28.00');
});

test('unknown variant is a DATA_ERROR with an auto-applicable removal', () => {
  const cart = priceCart(demoCatalog, { items: [{ variant_id: 'nope', quantity: 1 }], shipping_address: portland }, { mode: 'create', now });
  const issue = cart.validation_issues![0];
  assert.equal(issue.code, 'DATA_ERROR');
  assert.equal(issue.resolution_options![0].metadata?.auto_applicable, true);
});
