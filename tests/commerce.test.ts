import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Commerce, HttpError, MemoryCartStore, MemoryCatalogStore } from '../src/core/commerce.ts';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { Guard, MemoryGuardStore } from '../src/core/guard/engine.ts';
import { defaultMerchantPolicy, type Policy } from '../src/core/guard/policy.ts';
import { PayPalClient } from '../src/core/paypal/client.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '../src/core/paypal/executors.ts';
import { fakePayPal } from './fake-paypal.ts';

function setup(policy: Policy = defaultMerchantPolicy('shop_maya')) {
  const pp = fakePayPal();
  const paypal = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: pp.fetch });
  const catalogs = new MemoryCatalogStore([demoCatalog]);
  const guardStore = new MemoryGuardStore();
  const guard = new Guard({
    store: guardStore,
    executors: { 'payment.capture': captureExecutor(paypal), 'payment.void': voidExecutor(paypal), 'refund.create': refundExecutor(paypal) },
    policyFor: async () => policy,
  });
  const commerce = new Commerce({ paypal, carts: new MemoryCartStore(), catalogs, guard, baseUrl: 'https://sayso.test' });
  return { pp, commerce, catalogs, guardStore };
}

const address = { country_code: 'US', admin_area_1: 'TX', admin_area_2: 'Austin', postal_code: '78701' };

test('agent buys a mug end to end: cart -> PayPal approval -> authorize -> Guard capture', async () => {
  const { pp, commerce, catalogs } = setup();

  const cart = await commerce.createCart('maya-ceramics', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, 'chatgpt');
  assert.equal(cart.status, 'CREATED');
  assert.equal(cart.totals?.total.value, '44.99'); // 34.00 + 8.95 ground + 6% tax (2.04)
  assert.ok(cart.payment_method?.token?.startsWith('ORDER'));
  assert.match(cart.payment_method!.approval_url!, /checkoutnow/);

  // Checkout before the buyer approved: refused, nothing charged.
  await assert.rejects(commerce.checkout(cart.id!, { items: [], payment_method: { type: 'paypal', token: cart.payment_method!.token } }), (e: HttpError) => e.status === 422);

  pp.approve(cart.payment_method!.token!);
  const done = await commerce.checkout(cart.id!, { items: [], payment_method: { type: 'paypal', token: cart.payment_method!.token, payer_id: 'BUYER123' } });
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.payment_confirmation?.payment_status, 'CAPTURED');
  assert.match(done.payment_confirmation!.merchant_order_number, /^SAY-/);

  // Stock was decremented; a second checkout call is an idempotent replay, not a second charge.
  const catalog = await catalogs.bySlug('maya-ceramics');
  assert.equal(catalog!.products[0].variants[1].inventory, 5);
  const again = await commerce.checkout(cart.id!, { items: [], payment_method: { type: 'paypal', token: cart.payment_method!.token } });
  assert.equal(again.payment_confirmation?.merchant_order_number, done.payment_confirmation?.merchant_order_number);
});

test('PUT that changes the total gets a fresh PayPal order', async () => {
  const { commerce } = setup();
  const cart = await commerce.createCart('maya-ceramics', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address });
  const updated = await commerce.updateCart(cart.id!, { items: [{ variant_id: 'var_mug_sage', quantity: 2 }], shipping_address: address });
  assert.equal(updated.status, 'READY');
  assert.notEqual(updated.payment_method?.token, cart.payment_method?.token);
});

test('invalid carts get no PayPal order until the agent fixes them', async () => {
  const { commerce } = setup();
  const cart = await commerce.createCart('maya-ceramics', { items: [{ variant_id: 'var_mug_speckled', quantity: 2 }], shipping_address: address });
  assert.equal(cart.status, 'INCOMPLETE');
  assert.equal(cart.payment_method, undefined);

  // The agent applies the first resolution option (REDUCE_QUANTITY) and retries.
  const fixed = await commerce.updateCart(cart.id!, { items: [{ variant_id: 'var_mug_speckled', quantity: 1 }], shipping_address: address });
  assert.equal(fixed.status, 'READY');
  assert.ok(fixed.payment_method?.token);
});

test('if the item sells out while the buyer approves, nothing is authorized or charged', async () => {
  const { pp, commerce, catalogs } = setup();
  const cart = await commerce.createCart('maya-ceramics', { items: [{ variant_id: 'var_mug_speckled', quantity: 1 }], shipping_address: address });
  await catalogs.decrementInventory('shop_maya', 'var_mug_speckled', 1); // sold elsewhere meanwhile
  pp.approve(cart.payment_method!.token!);
  await assert.rejects(
    commerce.checkout(cart.id!, { items: [], payment_method: { type: 'paypal', token: cart.payment_method!.token } }),
    (e: HttpError) => e.status === 422 && (e.body as any).validation_issues[0].code === 'INVENTORY_ISSUE',
  );
  assert.equal(pp.orders.get(cart.payment_method!.token!)!.status, 'APPROVED'); // never authorized
});

test('big orders wait for the owner: authorized now, captured after say-so', async () => {
  const policy: Policy = { ownerId: 'shop_maya', rules: [{ id: 'big', type: 'max_amount', kinds: ['payment.capture'], limit: 10_000, then: 'require_approval' }] };
  const { pp, commerce, guardStore } = setup(policy);
  const cart = await commerce.createCart('maya-ceramics', { items: [{ variant_id: 'var_vase_custom', quantity: 2 }], shipping_address: address });
  pp.approve(cart.payment_method!.token!);
  const done = await commerce.checkout(cart.id!, { items: [], payment_method: { type: 'paypal', token: cart.payment_method!.token } });
  assert.equal(done.payment_confirmation?.payment_status, 'AUTHORIZED_PENDING_MERCHANT_REVIEW');
  const record = await guardStore.get(String(done.payment_confirmation?.guard_record_id));
  assert.equal(record?.status, 'pending_approval');
});

test('every PayPal write carried an idempotency key', async () => {
  const { pp, commerce } = setup();
  const cart = await commerce.createCart('maya-ceramics', { items: [{ variant_id: 'var_bowl_sand', quantity: 1 }], shipping_address: address });
  pp.approve(cart.payment_method!.token!);
  await commerce.checkout(cart.id!, { items: [], payment_method: { type: 'paypal', token: cart.payment_method!.token } });
  assert.equal(pp.requestIds.length, 3); // create order, authorize, capture
  assert.equal(new Set(pp.requestIds).size, 3);
});
