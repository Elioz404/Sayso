import assert from 'node:assert/strict';
import { test } from 'node:test';
import { address, stack } from './stack.ts';

const MAYA_PAYPAL = 'MAYAMERCHANT1';

async function buy(s: Awaited<ReturnType<typeof stack>>, quantity = 1) {
  const cart = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity }], shipping_address: address }, s.buyer);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  await s.commerce.checkout(cart.data.cart_id, { items: [], payment_method: { type: 'paypal', token } });
  return cart.data.cart_id as string;
}

test("connecting PayPal: Sayso keeps the account PayPal reports, only once it's complete", async () => {
  const s = await stack();
  assert.match(await s.payouts.connectLink('shop_maya'), /bizsignup\/partner\/entry\?referralToken=shop_maya/);
  assert.deepEqual(await s.payouts.finish('shop_maya'), { status: 'pending' }, 'nobody finished the sign-up yet');

  s.pp.onboard('shop_maya', MAYA_PAYPAL, { refund: false });
  const partial = await s.payouts.finish('shop_maya');
  assert.equal(partial.status, 'incomplete');
  assert.equal(await s.payouts.merchantFor('shop_maya'), undefined, 'not kept without the refund permission');

  s.pp.onboard('shop_maya', MAYA_PAYPAL);
  assert.deepEqual(await s.payouts.finish('shop_maya'), { status: 'connected', merchantId: MAYA_PAYPAL });
  assert.equal(await s.payouts.merchantFor('shop_maya'), MAYA_PAYPAL);
});

test("a connected owner's sales are paid to them, and refunded from their account on their behalf", async () => {
  const s = await stack();
  s.pp.onboard('shop_maya', MAYA_PAYPAL);
  await s.payouts.finish('shop_maya');

  const cartId = await buy(s, 2);
  const order = s.pp.orders.get((await s.carts.get(cartId))!.orderId!)!;
  assert.equal(order.purchase_units[0].payee.merchant_id, MAYA_PAYPAL, 'the money goes to Maya, not Sayso');

  // Without acting for Maya, PayPal refuses the refund (the fake enforces it like the sandbox does).
  const refund = await s.call('refund_order', { order_id: cartId, amount: '10.00', reason: 'Chipped rim' }, s.owner);
  assert.equal(refund.data.status, 'verified');
});

test("sales from before the owner connected are refunded from Sayso's account, where they were paid", async () => {
  const s = await stack();
  const before = await buy(s);
  s.pp.onboard('shop_maya', MAYA_PAYPAL);
  await s.payouts.finish('shop_maya');

  const order = s.pp.orders.get((await s.carts.get(before))!.orderId!)!;
  assert.equal(order.purchase_units[0].payee, undefined);
  assert.equal((await s.call('refund_order', { order_id: before, amount: '5.00', reason: 'Chipped rim' }, s.owner)).data.status, 'verified');
});

test('disconnecting sends new sales back to Sayso; tour copies never connect', async () => {
  const s = await stack();
  s.pp.onboard('shop_maya', MAYA_PAYPAL);
  await s.payouts.finish('shop_maya');
  await s.payouts.disconnect('shop_maya');
  const cartId = await buy(s);
  assert.equal(s.pp.orders.get((await s.carts.get(cartId))!.orderId!)!.purchase_units[0].payee, undefined);

  await s.catalogs.modify('shop_maya', (c) => ((c.shop.visibility = 'private'), true));
  await assert.rejects(s.payouts.connectLink('shop_maya'), /tour copy/);
});
