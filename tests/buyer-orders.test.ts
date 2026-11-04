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
  assert.ok(waiting.refundPending);
  assert.equal(waiting.state, 'refund-asked');
  assert.deepEqual(steps(waiting), [['Paid', true], ['Preparing', true], ['Shipped', true], ['Refund asked', true], ['Shop decides', false]]);

  assert.match(ordersForAssistant([waiting]), new RegExp(`${waiting.number} from Maya Ceramics \\(cart_id ${id}`));
});

const steps = (o: { steps: { label: string; done: boolean; stop?: boolean }[] }) => o.steps.map((st) => (st.stop ? [st.label, 'stop'] : [st.label, st.done]));

test('the steps follow what happened: a refund declined, asked again, then refunded in full', async () => {
  const s = await stack();
  const deps = { carts: s.carts, catalogs: s.catalogs, orders: s.orders, links: links('https://sayso.test') };
  const id = await buy(s, 'var_mug_sage', ALEX);
  const ask = async () => (await s.call('request_refund', { cart_id: id, reason: 'It is not the green I expected.' }, { channel: 'sayso-assistant', marketplace: true })).data.request_id as string;

  const first = await ask();
  assert.deepEqual(steps((await buyerOrder(deps, id))!), [['Paid', true], ['Refund asked', true], ['Shop decides', false]], 'not shipped: the shop decides first');

  await s.saySo.decide('shop_maya', first, 'reject', 'owner:shop_maya', { note: 'Colours vary by kiln' });
  const declined = (await buyerOrder(deps, id))!;
  assert.equal(declined.state, 'paid');
  assert.deepEqual(steps(declined), [['Paid', true], ['Refund asked', true], ['Refund declined', 'stop'], ['Preparing', false], ['Shipped', false]]);
  assert.ok(declined.canAskRefund, 'a declined request can be asked again');

  await s.saySo.decide('shop_maya', await ask(), 'approve', 'owner:shop_maya');
  const refunded = (await buyerOrder(deps, id))!;
  assert.equal(refunded.state, 'refunded');
  assert.match(refunded.status, /^Refunded in full \(\$[\d.]+\) through PayPal\.$/);
  assert.deepEqual(steps(refunded), [['Paid', true], ['Refund asked', true], ['Refunded', true]], 'nothing left to ship, and only the latest request is a step');
  assert.ok(!refunded.canAskRefund);
});

test('a partial refund is a step and part of the status; the order still ships', async () => {
  const s = await stack();
  const deps = { carts: s.carts, catalogs: s.catalogs, orders: s.orders, links: links('https://sayso.test') };
  const id = await buy(s, 'var_mug_sage', ALEX);
  const refund = await s.call('refund_order', { order_id: id, amount: '10.00', reason: 'Small chip on the rim' }, s.owner);
  assert.equal(refund.data.status, 'verified', refund.text);

  const partly = (await buyerOrder(deps, id))!;
  assert.equal(partly.state, 'paid');
  assert.equal(partly.status, 'Charged. The shop is preparing the order. $10.00 refunded through PayPal.');
  assert.deepEqual(steps(partly), [['Paid', true], ['Partly refunded', true], ['Preparing', false], ['Shipped', false]]);

  await s.call('add_tracking', { order_id: id, carrier: 'UPS', tracking_number: '1Z999AA10123456784' }, s.owner);
  const shipped = (await buyerOrder(deps, id))!;
  assert.equal(shipped.state, 'shipped');
  assert.deepEqual(steps(shipped), [['Paid', true], ['Partly refunded', true], ['Preparing', true], ['Shipped', true]], 'in the order it happened');
});

test('an order the shop holds and then turns down ends at Cancelled', async () => {
  const s = await stack();
  const deps = { carts: s.carts, catalogs: s.catalogs, orders: s.orders, links: links('https://sayso.test') };
  await s.policies.put({ ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'all', type: 'always_approve', kinds: ['payment.capture'] }] });
  const id = await buy(s, 'var_mug_sage', ALEX);

  const held = (await buyerOrder(deps, id))!;
  assert.equal(held.state, 'waiting');
  assert.deepEqual(steps(held), [['Authorized', true], ['Shop confirms', false], ['Shipped', false]]);

  const [capture] = await s.guard.list('shop_maya', { cartId: id, kind: 'payment.capture' });
  await s.saySo.decide('shop_maya', capture.id, 'reject', 'owner:shop_maya', { note: 'Out of glaze' });
  const cancelled = (await buyerOrder(deps, id))!;
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(steps(cancelled), [['Authorized', true], ['Cancelled', 'stop']]);
  assert.ok(!cancelled.canAskRefund);
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
