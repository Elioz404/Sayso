// A buyer's orders without an account: each order at its own link, every order a PayPal account paid for
// once they sign in with it, and never anyone else's. What they see follows the order: paid, shipped,
// a refund they asked for.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buyerOrder, buyerOrders, ordersForAssistant } from '../src/core/buyer-orders.ts';
import { links } from '../src/core/links.ts';
import { trackingLink } from '../src/core/shipping.ts';
import { paidByPayer } from '../src/core/stores.ts';
import { address, stack } from './stack.ts';

/** A paid order from one PayPal account (the fake says who paid when the buyer approves). */
async function buy(s: Awaited<ReturnType<typeof stack>>, variant: string, payer: { payer_id: string; email_address: string }) {
  const cart = (await s.call('create_cart', { items: [{ variant_id: variant, quantity: 1 }], shipping_address: address }, s.buyer)).data;
  const token = new URL(cart.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  s.pp.orders.get(token)!.payer = payer;
  await s.commerce.checkout(cart.cart_id, { items: [], payment_method: { type: 'paypal', token } });
  return cart.cart_id as string;
}

const ALEX = { payer_id: 'ALEX123', email_address: 'alex@example.com' };
const SAM = { payer_id: 'SAM456', email_address: 'sam@example.com' };

test("signing in with PayPal finds that account's orders, and only those", async () => {
  const s = await stack();
  const deps = { carts: s.carts, catalogs: s.catalogs, orders: s.orders, links: links('https://sayso.test') };
  const alexMug = await buy(s, 'var_mug_sage', ALEX);
  const samBowl = await buy(s, 'var_bowl_sand', SAM);

  const alex = await buyerOrders(deps, { payerId: 'ALEX123', email: 'alex@example.com' });
  assert.deepEqual(alex.map((o) => o.id), [alexMug]);
  assert.deepEqual((await buyerOrders(deps, { payerId: 'SAM456' })).map((o) => o.id), [samBowl]);
  assert.deepEqual(await buyerOrders(deps, { payerId: 'NOBODY', email: 'nobody@example.com' }), []);

  // Orders saved before payer ids were kept still match by the email PayPal reported...
  const stored = (await s.carts.get(alexMug))!;
  delete stored.payerId;
  assert.ok(paidByPayer(stored, { payerId: 'ALEX123', email: 'ALEX@example.com' }));
  // ...but a payer id that differs wins over a matching email.
  assert.ok(!paidByPayer((await s.carts.get(samBowl))!, { payerId: 'ALEX123', email: 'sam@example.com' }));
});

test('an order at its link: where it stands, then shipped, then a refund the buyer asked for', async () => {
  const s = await stack();
  const deps = { carts: s.carts, catalogs: s.catalogs, orders: s.orders, links: links('https://sayso.test') };
  const id = await buy(s, 'var_mug_sage', ALEX);

  const paid = (await buyerOrder(deps, id))!;
  assert.equal(paid.state, 'paid');
  assert.equal(paid.status, 'Charged. The shop is preparing the order.');
  assert.deepEqual(paid.steps.map((st) => [st.label, st.done]), [['Paid', true], ['Preparing', false], ['Shipped', false]]);
  assert.equal(paid.shop.name, 'Maya Ceramics');
  assert.deepEqual(paid.items.map((i) => [i.name, i.detail, i.qty]), [['Hand-thrown Mug', 'Sage Green', 1]]);
  assert.match(paid.items[0].url!, /\/shop\/maya-ceramics\//);
  assert.ok(paid.canAskRefund);
  assert.ok(!JSON.stringify(paid).includes('ALEX123'), 'no payer ids or internal records in what the buyer sees');

  await s.call('add_tracking', { order_id: id, carrier: 'USPS', tracking_number: '9400100000000000000000' }, s.owner);
  const shipped = (await buyerOrder(deps, id))!;
  assert.equal(shipped.state, 'shipped');
  assert.equal(shipped.tracking?.carrier, 'USPS');
  assert.equal(shipped.tracking?.url, trackingLink('USPS', '9400100000000000000000'));
  assert.ok(shipped.steps.every((st) => st.done));

  // The buyer asks through Sayso's assistant (the order page hands it the request): it waits for the owner.
  const asked = await s.call('request_refund', { cart_id: id, reason: 'The handle arrived cracked.' }, { channel: 'sayso-assistant', marketplace: true });
  assert.ok(!asked.isError, asked.text);
  assert.equal(asked.data.status, 'waiting for the shop owner');
  const waiting = (await buyerOrder(deps, id))!;
  assert.equal(waiting.refundRequests.length, 1);
  assert.ok(!waiting.canAskRefund, 'one request at a time');

  assert.match(ordersForAssistant([waiting]), new RegExp(`${waiting.number} from Maya Ceramics \\(cart_id ${id}`));
});

test("a link that isn't a placed order shows nothing", async () => {
  const s = await stack();
  const deps = { carts: s.carts, catalogs: s.catalogs, orders: s.orders, links: links('https://sayso.test') };
  const unpaid = (await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, s.buyer)).data;
  assert.equal(await buyerOrder(deps, unpaid.cart_id), undefined);
  assert.equal(await buyerOrder(deps, 'cart_nope'), undefined);
  assert.equal(await buyerOrder(deps, '../../etc'), undefined);
});

test('tracking links for the carriers people know', () => {
  assert.equal(trackingLink('UPS', '1Z999'), 'https://www.ups.com/track?tracknum=1Z999');
  assert.match(trackingLink('FEDEX', '1234')!, /fedex\.com/);
  assert.equal(trackingLink('OTHER', '1234'), undefined);
});
