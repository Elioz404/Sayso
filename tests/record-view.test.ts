// What Activity shows for a record follows the record as it is now: a request waiting for the owner, their
// answer, then PayPal's read-back. The Why column in particular stops saying "only you decide" once the
// owner has.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordView, whyNow } from '../src/core/record-view.ts';
import { address, stack } from './stack.ts';

type Stack = Awaited<ReturnType<typeof stack>>;
const plain = (text: string) => text;

async function paidOrder(s: Stack) {
  const cart = (await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, s.buyer)).data;
  const token = new URL(cart.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  await s.commerce.checkout(cart.cart_id, { items: [], payment_method: { type: 'paypal', token } });
  return cart.cart_id as string;
}
const view = async (s: Stack, id: string) => recordView(await s.saySo.record('shop_maya', id), plain);
const ask = async (s: Stack, cartId: string) =>
  (await s.call('request_refund', { cart_id: cartId, reason: 'The handle arrived cracked.' }, { channel: 'sayso-assistant', marketplace: true })).data.request_id as string;

test("a buyer's refund request: waiting, then the owner's answer, then PayPal's read-back", async () => {
  const s = await stack();
  const cartId = await paidOrder(s);

  const first = await ask(s, cartId);
  const waiting = await view(s, first);
  assert.equal(waiting.outcome, 'Waiting for you');
  assert.equal(waiting.by, "Buyer's assistant (Shop with AI)");
  assert.equal(waiting.paypal, 'none');
  assert.ok(!waiting.stopped && !waiting.decided);
  assert.equal(whyNow(waiting), waiting.hits.join(' '), 'while it waits: the rule that holds it');
  assert.ok(waiting.hits.length > 0);

  await s.saySo.decide('shop_maya', first, 'reject', 'owner:shop_maya', { note: 'Send a photo of the crack first' });
  const declined = await view(s, first);
  assert.equal(declined.outcome, 'You said no');
  assert.ok(declined.stopped, 'nothing moved: the amount is struck through');
  assert.equal(declined.decided?.approved, false);
  assert.equal(whyNow(declined), 'Your note: Send a photo of the crack first');

  const second = await ask(s, cartId);
  await s.saySo.decide('shop_maya', second, 'approve', 'owner:shop_maya');
  const refunded = await view(s, second);
  assert.equal(refunded.outcome, 'You said OK');
  assert.equal(refunded.status, 'verified');
  assert.equal(refunded.paypal, 'ok');
  assert.ok(refunded.paypalDetail);
  assert.equal(whyNow(refunded), 'The handle arrived cracked.', "once answered: the buyer's own reason, not the rule");
  assert.ok(refunded.amount && !refunded.stopped);
});

test('a charge the rules allow, a refund blocked before PayPal, and a rule change', async () => {
  const s = await stack();
  const cartId = await paidOrder(s);

  const [capture] = await s.guard.list('shop_maya', { cartId, kind: 'payment.capture' });
  const charged = await view(s, capture.id);
  assert.equal(charged.outcome, 'Allowed by your rules');
  assert.equal(charged.by, 'Sayso checkout');
  assert.equal(charged.paypal, 'ok');
  assert.equal(whyNow(charged), charged.reason);

  await s.call('refund_order', { order_id: cartId, amount: '500.00', reason: 'Everything twice' }, s.owner);
  const [refund] = await s.guard.list('shop_maya', { cartId, kind: 'refund.create' });
  const blocked = await view(s, refund.id);
  assert.equal(blocked.outcome, 'Blocked by a rule');
  assert.ok(blocked.stopped);
  assert.equal(blocked.paypal, 'none');
  assert.match(whyNow(blocked), /refundable/);

  // Sent but not read back yet: neither confirmed nor "nothing moved".
  const sent = recordView({ ...(await s.saySo.record('shop_maya', capture.id)), status: 'executed', verification: undefined }, plain);
  assert.equal(sent.paypal, 'sent');

  const policy = recordView({ ...(await s.saySo.record('shop_maya', capture.id)), action: { ...capture.action, kind: 'policy.update' } }, plain);
  assert.equal(policy.paypal, 'none', 'a rule change never goes to PayPal');
});

test('personal details are masked for the shared demo session', async () => {
  const s = await stack();
  const cartId = await paidOrder(s);
  const [capture] = await s.guard.list('shop_maya', { cartId, kind: 'payment.capture' });
  const masked = recordView(await s.saySo.record('shop_maya', capture.id), () => '•••');
  assert.ok([masked.reason, ...masked.effects].every((t) => t === '•••'));
  if (masked.counterparty) assert.equal(masked.counterparty, '•••');
});
