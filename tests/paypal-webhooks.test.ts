// PayPal's webhooks: only deliveries PayPal signed are read, and each event is only a hint. What it names
// is read back from PayPal with the account that owns it, matched to its order, and recorded once:
// money that moved in PayPal shows in the order, the sales and Activity exactly like PayPal has it, and
// Sayso's own refunds are never counted twice.

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';
import type { Policy } from '../src/core/guard/policy.ts';
import { PayPalEvents } from '../src/core/paypal-events.ts';
import { SIMULATOR_WEBHOOK_ID, transmissionOf, WebhookVerifier, type Transmission, type WebhookEvent } from '../src/core/paypal/webhooks.ts';
import { outcomeOf } from '../src/core/trust-report.ts';
import { address, stack } from './stack.ts';

type Stack = Awaited<ReturnType<typeof stack>>;

// ---- Signatures ----

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERT = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77';
const NOW = Date.parse('2026-11-05T12:00:00Z');

function signed(body: string, webhookId: string, overrides: Partial<Transmission> = {}): Transmission {
  const t = { id: 'b2384410-f8d2-11ef-a3bd-1b2d9f5bb4fb', time: new Date(NOW - 5_000).toISOString(), certUrl: CERT, algorithm: 'SHA256withRSA', ...overrides };
  const signature = sign('sha256', Buffer.from(`${t.id}|${t.time}|${webhookId}|${crc32(Buffer.from(body))}`), privateKey).toString('base64');
  return { signature, ...t, ...(overrides.signature ? { signature: overrides.signature } : {}) };
}

const verifier = (acceptSimulator = false) => new WebhookVerifier({ webhookId: 'WH-REAL', acceptSimulator, publicKey: async () => publicKey, now: () => NOW });
const body = JSON.stringify({ id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'REF1' } });

test('only a delivery PayPal signed, for this webhook, unaltered and recent, is read', async () => {
  assert.equal((await verifier().verify(body, signed(body, 'WH-REAL')))?.event.id, 'WH-EVT-1');
  assert.equal((await verifier().verify(body, signed(body, 'WH-REAL')))?.from, 'webhook');

  assert.equal(await verifier().verify(body.replace('REF1', 'REF2'), signed(body, 'WH-REAL')), undefined, 'the body was changed');
  assert.equal(await verifier().verify(body, signed(body, 'WH-SOMEONE-ELSE')), undefined, "another app's webhook");
  assert.equal(await verifier().verify(body, signed(body, 'WH-REAL', { certUrl: 'https://evil.example/cert.pem' })), undefined, 'a certificate not from PayPal');
  assert.equal(await verifier().verify(body, signed(body, 'WH-REAL', { certUrl: 'https://paypal.com.evil.example/cert.pem' })), undefined);
  assert.equal(await verifier().verify(body, signed(body, 'WH-REAL', { time: new Date(NOW - 9 * 86_400_000).toISOString() })), undefined, 'too old to be a resend');
  assert.equal(await verifier().verify(body, undefined), undefined, 'no signature headers');
  assert.equal(await verifier().verify('not json', signed('not json', 'WH-REAL')), undefined, 'signed, but not an event');

  // The simulator signs with "WEBHOOK_ID": accepted only where the server allows it.
  assert.equal(await verifier().verify(body, signed(body, SIMULATOR_WEBHOOK_ID)), undefined);
  assert.equal((await verifier(true).verify(body, signed(body, SIMULATOR_WEBHOOK_ID)))?.from, 'simulator');
});

test('the signature headers are read as PayPal names them', () => {
  const headers = new Headers({ 'paypal-transmission-id': 'a', 'paypal-transmission-time': 't', 'paypal-cert-url': CERT, 'paypal-transmission-sig': 's', 'paypal-auth-algo': 'SHA256withRSA' });
  assert.deepEqual(transmissionOf((n) => headers.get(n)), { id: 'a', time: 't', certUrl: CERT, signature: 's', algorithm: 'SHA256withRSA' });
  headers.delete('paypal-transmission-sig');
  assert.equal(transmissionOf((n) => headers.get(n)), undefined);
});

// ---- Events ----

const askForCaptures: Policy = { ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'all', type: 'always_approve', kinds: ['payment.capture'] }] };
let n = 0;
const event = (event_type: string, resource: Record<string, unknown>): WebhookEvent => ({ id: `WH-${++n}`, event_type, resource });
const events = (s: Stack) => new PayPalEvents({ paypal: s.paypal, carts: s.carts, guard: s.guard, commerce: s.commerce, invoicing: s.invoicing, payouts: s.payouts });

async function placedOrder(s: Stack, variant = 'var_mug_sage') {
  const cart = await s.call('create_cart', { items: [{ variant_id: variant, quantity: 1 }], shipping_address: address }, s.buyer);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  await s.commerce.checkout(cart.data.cart_id, { items: [], payment_method: { type: 'paypal', token } });
  return (await s.carts.get(cart.data.cart_id))!;
}

test('a refund made in PayPal is recorded once, read back from PayPal, and shows everywhere', async () => {
  const s = await stack();
  const handle = events(s);
  const cart = await placedOrder(s);
  const refund = s.pp.inPayPal.refund(cart.captureId!, { currency_code: 'USD', value: '10.00' });

  const first = await handle.handle(event('PAYMENT.CAPTURE.REFUNDED', refund));
  assert.equal(first.result, 'recorded');
  const again = await handle.handle(event('PAYMENT.CAPTURE.REFUNDED', refund));
  assert.equal(again.result, 'known', 'PayPal resends; nothing is recorded twice');

  const { order, records } = await s.orders.get('shop_maya', cart.id);
  assert.equal(order.refundedMinor, 1_000);
  const recorded = records.filter((r) => r.action.kind === 'refund.create');
  assert.equal(recorded.length, 1);
  assert.equal(outcomeOf(recorded[0]), 'Done in PayPal');
  assert.equal(recorded[0].verification?.ok, true);
  assert.equal(s.approvals.length, 0, 'nothing waits for the owner: it already happened');
});

test("Sayso's own refund is recognised when its webhook arrives", async () => {
  const s = await stack();
  const cart = await placedOrder(s);
  const asked = await s.call('refund_order', { order_id: cart.id, reason: 'Chipped in transit' }, s.owner);
  assert.equal(asked.isError, false, asked.text);
  const [ours] = (await s.orders.get('shop_maya', cart.id)).records.filter((r) => r.action.kind === 'refund.create');
  const refund = { id: String(ours.result?.refund_id), links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cart.captureId}` }] };

  assert.equal((await events(s).handle(event('PAYMENT.CAPTURE.REFUNDED', refund))).result, 'known');
  assert.equal((await s.orders.get('shop_maya', cart.id)).order.refundedMinor, ours.action.amount, 'counted once');
});

test('a reversal takes back what was still captured', async () => {
  const s = await stack();
  const cart = await placedOrder(s);
  await events(s).handle(event('PAYMENT.CAPTURE.REFUNDED', s.pp.inPayPal.refund(cart.captureId!, { currency_code: 'USD', value: '5.00' })));
  const capture = s.pp.inPayPal.reverse(cart.captureId!);
  assert.equal((await events(s).handle(event('PAYMENT.CAPTURE.REVERSED', capture))).result, 'recorded');
  assert.equal((await events(s).handle(event('PAYMENT.CAPTURE.REVERSED', capture))).result, 'known');
  const { order } = await s.orders.get('shop_maya', cart.id);
  assert.equal(order.refundedMinor, order.totalMinor, 'all of it is back with the buyer');
});

test('a hold that ends in PayPal releases the order and its stock, once', async () => {
  const s = await stack();
  await s.policies.put(askForCaptures);
  const before = (await s.catalogs.byShopId('shop_maya'))!.products.flatMap((p) => p.variants).find((v) => v.id === 'var_mug_sage')!.inventory;
  const cart = await placedOrder(s);
  assert.equal(cart.captureId, undefined, 'waiting for the owner');
  const auth = s.pp.inPayPal.void(cart.authorizationId!, 'EXPIRED');

  assert.equal((await events(s).handle(event('PAYMENT.AUTHORIZATION.VOIDED', auth))).result, 'released');
  assert.equal((await events(s).handle(event('PAYMENT.AUTHORIZATION.VOIDED', auth))).result, 'known');
  const after = (await s.carts.get(cart.id))!;
  assert.equal(after.released?.holdVoided, true);
  assert.match(after.released!.reason, /ran out/);
  assert.equal((await s.catalogs.byShopId('shop_maya'))!.products.flatMap((p) => p.variants).find((v) => v.id === 'var_mug_sage')!.inventory, before);
  assert.equal((await s.orders.get('shop_maya', cart.id)).order.status, 'released');
});

test("a buyer's dispute is kept on the order as PayPal has it", async () => {
  const s = await stack();
  const cart = await placedOrder(s);
  const dispute = s.pp.inPayPal.dispute(cart.captureId!);
  assert.equal((await events(s).handle(event('CUSTOMER.DISPUTE.CREATED', dispute))).result, 'updated');
  assert.equal((await events(s).handle(event('CUSTOMER.DISPUTE.CREATED', dispute))).result, 'known');
  const [kept] = (await s.carts.get(cart.id))!.disputes!;
  assert.equal(kept.status, 'WAITING_FOR_SELLER_RESPONSE');
  assert.equal(kept.reason, 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED');
  assert.ok(kept.respondBy);
});

test('events about anything that is not one of Sayso\'s orders change nothing', async () => {
  const s = await stack();
  const cart = await placedOrder(s);
  const other = await placedOrder(s, 'var_bowl_sand');
  const handle = events(s);
  // What the Webhooks Simulator sends: made-up ids.
  assert.equal((await handle.handle(event('PAYMENT.CAPTURE.REFUNDED', { id: '1Q1234567890', links: [{ rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/2GG279541U471931P' }] }))).result, 'not-ours');
  assert.equal((await handle.handle(event('PAYMENT.AUTHORIZATION.VOIDED', { id: '0VF52814937998046' }))).result, 'not-ours');
  assert.equal((await handle.handle(event('CUSTOMER.DISPUTE.CREATED', { dispute_id: 'PP-D-1', disputed_transactions: [{ seller_transaction_id: 'NOPE' }] }))).result, 'not-ours');
  // A refund of one order, claimed to be about another: PayPal's own link decides.
  const refund = s.pp.inPayPal.refund(other.captureId!);
  assert.equal((await handle.handle(event('PAYMENT.CAPTURE.REFUNDED', { ...refund, links: [{ rel: 'up', href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cart.captureId}` }] }))).result, 'not-ours');
  assert.equal((await s.orders.get('shop_maya', cart.id)).order.refundedMinor, 0);
  assert.equal((await handle.handle(event('BILLING.SUBSCRIPTION.CREATED', {}))).result, 'ignored');
});

test("a connected seller's PayPal: read back as theirs, and disconnected when they take back consent", async () => {
  const s = await stack();
  s.pp.onboard('shop_maya', 'MERCHANT_MAYA');
  assert.equal((await events(s).handle(event('MERCHANT.ONBOARDING.COMPLETED', { tracking_id: 'shop_maya', merchant_id: 'MERCHANT_MAYA' }))).result, 'connected');
  const cart = await placedOrder(s);
  assert.equal(cart.payee, 'MERCHANT_MAYA');
  // The refund is the seller's: Sayso reads it acting for them.
  assert.equal((await events(s).handle(event('PAYMENT.CAPTURE.REFUNDED', s.pp.inPayPal.refund(cart.captureId!)))).result, 'recorded');

  s.pp.inPayPal.revoke('MERCHANT_MAYA');
  assert.equal((await events(s).handle(event('MERCHANT.PARTNER-CONSENT.REVOKED', { merchant_id: 'MERCHANT_MAYA' }))).result, 'disconnected');
  assert.equal((await s.catalogs.byShopId('shop_maya'))!.shop.payout, undefined, 'new sales go to Sayso again');
  assert.equal((await events(s).handle(event('MERCHANT.PARTNER-CONSENT.REVOKED', { merchant_id: 'SOMEONE_ELSE' }))).result, 'not-ours');
});

test("the owner's agent and the Overview see disputes and PayPal's own refunds", async () => {
  const s = await stack();
  const cart = await placedOrder(s);
  await events(s).handle(event('CUSTOMER.DISPUTE.CREATED', s.pp.inPayPal.dispute(cart.captureId!, 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED')));
  await events(s).handle(event('PAYMENT.CAPTURE.REFUNDED', s.pp.inPayPal.refund(cart.captureId!, { currency_code: 'USD', value: '4.99' })));

  const seen = await s.call('get_order', { order_id: cart.id }, s.owner);
  assert.equal(seen.isError, false, seen.text);
  assert.equal(seen.data.dispute, 'open');
  assert.match(seen.data.disputes[0].what, /not as described/);
  assert.match(seen.data.disputes[0].answered_in, /Resolution Center/);
  assert.ok(seen.data.say_so.some((r: { next: string }) => /Done in PayPal itself/.test(r.next)));

  assert.deepEqual((await s.orders.openDisputes('shop_maya')).map((c) => c.id), [cart.id]);
  const sales = await s.orders.salesSummary({ id: 'shop_maya', currency: 'USD' }, { period: 'today' });
  assert.equal(sales.refunds, '$4.99', 'a refund made in PayPal is a refund in the sales figures too');
});
