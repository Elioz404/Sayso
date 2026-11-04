// The ways money could move wrongly, each pinned down: amounts left out, read-backs that break,
// concurrent clicks, holds and stock that must come back, and rules no policy can switch off.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { variantRows } from '../src/core/catalog-view.ts';
import { Guard, MemoryGuardStore } from '../src/core/guard/engine.ts';
import type { Policy } from '../src/core/guard/policy.ts';
import type { Executor, ProposedAction } from '../src/core/guard/types.ts';
import { Channel3 } from '../src/core/channel3.ts';
import { MarketPrices, priceReference } from '../src/core/market.ts';
import { parseAmount } from '../src/core/money.ts';
import { address, stack } from './stack.ts';

type Stack = Awaited<ReturnType<typeof stack>>;

/** A buyer's assistant fills a cart and the buyer approves it in PayPal. Returns the cart id and PayPal token. */
async function approvedCart(s: Stack, items: { variant_id: string; quantity: number }[]) {
  const cart = await s.call('create_cart', { items, shipping_address: address }, s.buyer);
  assert.equal(cart.isError, false, cart.text);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  return { cartId: cart.data.cart_id as string, token };
}

const pay = (s: Stack, cartId: string, token: string) => s.commerce.checkout(cartId, { items: [], payment_method: { type: 'paypal', token } });
const stock = async (s: Stack, variantId: string) =>
  (await s.catalogs.byShopId('shop_maya'))!.products.flatMap((p) => p.variants).find((v) => v.id === variantId)!.inventory;
const askForCaptures: Policy = { ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'all', type: 'always_approve', kinds: ['payment.capture'] }] };

test('a full refund with no amount is judged at what it would really refund', async () => {
  const s = await stack();
  const { cartId, token } = await approvedCart(s, [{ variant_id: 'var_mug_sage', quantity: 2 }]);
  await pay(s, cartId, token);

  const refund = await s.call('refund_order', { order_id: cartId, reason: 'Both arrived broken' }, s.owner);
  assert.equal(refund.data.status, 'pending_approval', 'over the $50 refund cap, so the owner decides');
  assert.equal(refund.data.amount, '$81.03'); // everything still refundable
  assert.ok(refund.data.why.some((w: string) => /over the \$50\.00 limit/.test(w)));
});

test('if reading a capture back fails, the order is unverified, not "not charged"', async () => {
  const s = await stack();
  const { cartId, token } = await approvedCart(s, [{ variant_id: 'var_bowl_sand', quantity: 1 }]);
  s.pp.failReads('/v2/payments/captures/');
  const done = await pay(s, cartId, token);
  s.pp.failReads(undefined);

  assert.equal(done.payment_confirmation?.payment_status, 'CAPTURED');
  const record = await s.guardStore.get(String(done.payment_confirmation?.guard_record_id));
  assert.equal(record?.status, 'unverified');
  assert.equal((await s.orders.get('shop_maya', cartId)).order.status, 'paid');
  assert.equal(await stock(s, 'var_bowl_sand'), 2, 'the stock stays sold');
});

test('two checkouts of the same cart at once charge once and take stock once', async () => {
  const s = await stack();
  const { cartId, token } = await approvedCart(s, [{ variant_id: 'var_mug_sage', quantity: 1 }]);
  const [a, b] = await Promise.all([pay(s, cartId, token), pay(s, cartId, token)]);

  assert.equal(a.payment_confirmation?.merchant_order_number, b.payment_confirmation?.merchant_order_number);
  assert.equal(s.pp.requestIds.filter((id) => id.endsWith('-capture')).length, 1);
  assert.equal(await stock(s, 'var_mug_sage'), 5);
});

test('the same variant on two lines counts against one stock', async () => {
  const s = await stack();
  const cart = await s.call('create_cart', { items: [{ variant_id: 'var_mug_speckled', quantity: 1 }, { variant_id: 'var_mug_speckled', quantity: 1 }], shipping_address: address }, s.buyer);
  assert.equal(cart.data.status, 'INCOMPLETE');
  assert.equal(cart.data.validation_issues[0].code, 'INVENTORY_ISSUE');
  assert.equal(cart.data.approval_url, undefined);
});

test('re-sending an unchanged cart keeps its PayPal link and ignores fields only the shop sets', async () => {
  const s = await stack();
  const items = [{ variant_id: 'var_mug_sage', quantity: 1 }];
  const created = await s.call('create_cart', { items, shipping_address: address }, s.buyer);
  const updated = await s.commerce.updateCart(created.data.cart_id, {
    items,
    shipping_address: address,
    payment_method: { type: 'paypal', token: 'EVIL', approval_url: 'https://evil.example/pay' },
  });
  assert.equal(updated.payment_method?.approval_url, created.data.approval_url);
  assert.notEqual(updated.payment_method?.token, 'EVIL');
});

test('when the owner rejects a held order, the hold is released and the stock comes back', async () => {
  const s = await stack();
  await s.policies.put(askForCaptures);
  const { cartId, token } = await approvedCart(s, [{ variant_id: 'var_mug_sage', quantity: 2 }]);
  const placed = await pay(s, cartId, token);
  assert.equal(placed.payment_confirmation?.payment_status, 'AUTHORIZED_PENDING_MERCHANT_REVIEW');
  assert.equal(await stock(s, 'var_mug_sage'), 4, 'held for the buyer meanwhile');

  await s.saySo.decide('shop_maya', String(placed.payment_confirmation?.guard_record_id), 'reject', 'owner:shop_maya', { note: 'Too big' });
  const { cart, order } = await s.orders.get('shop_maya', cartId);
  assert.equal(order.status, 'released');
  assert.equal(cart.released?.holdVoided, true);
  assert.equal(s.pp.authorizations.get(cart.authorizationId!)?.status, 'VOIDED');
  assert.equal(await stock(s, 'var_mug_sage'), 6);
});

test('an approved capture that PayPal refuses releases the order instead of leaving it on hold', async () => {
  const s = await stack();
  await s.policies.put(askForCaptures);
  const { cartId, token } = await approvedCart(s, [{ variant_id: 'var_bowl_sand', quantity: 1 }]);
  const placed = await pay(s, cartId, token);
  const { cart } = await s.orders.get('shop_maya', cartId);
  s.pp.authorizations.get(cart.authorizationId!)!.status = 'EXPIRED'; // the owner waited too long

  const decided = await s.saySo.decide('shop_maya', String(placed.payment_confirmation?.guard_record_id), 'approve', 'owner:shop_maya');
  assert.equal(decided.status, 'failed');
  assert.equal((await s.orders.get('shop_maya', cartId)).order.status, 'released');
  assert.equal(await stock(s, 'var_bowl_sand'), 3);
});

test('someone who sends their connect link to another person never gets to spend that person\'s PayPal', async () => {
  const s = await stack();
  const attacker = await s.call('connect_paypal', { assistant_name: 'ChatGPT' }, s.buyer);
  const walletId = new URL(attacker.data.connect_url).pathname.split('/').pop()!;
  // The victim opens the link, picks limits and approves in PayPal. The pairing code is shown to them only.
  await s.wallets.startConnect(walletId, { perOrder: '50', daily: '80' });
  s.pp.approveSetup((await s.wallets.get(walletId)).setupTokenId!);
  await s.wallets.finishConnect(walletId);

  const cart = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, s.buyer);
  const pay = await s.call('pay_with_paypal', { cart_id: cart.data.cart_id, wallet_key: attacker.data.wallet_key }, s.buyer);
  assert.equal(pay.isError, true);
  for (const guess of ['AAAA-AAAA', 'BBBB-BBBB', 'CCCC-CCCC', 'DDDD-DDDD', 'EEEE-EEEE']) await s.call('wallet_status', { wallet_key: attacker.data.wallet_key, claim_code: guess }, s.buyer);
  assert.match((await s.call('wallet_status', { wallet_key: attacker.data.wallet_key, claim_code: 'FFFF-FFFF' }, s.buyer)).text, /No pairing code is waiting/, 'guessing burns the code');
  assert.notEqual((await s.call('get_cart', { cart_id: cart.data.cart_id }, s.buyer)).data.status, 'COMPLETED');
});

test('a purchase over the buyer\'s limits goes to PayPal approval and leaves nothing pending', async () => {
  const s = await stack();
  const connect = await s.call('connect_paypal', { assistant_name: 'ChatGPT' }, s.buyer);
  const walletId = new URL(connect.data.connect_url).pathname.split('/').pop()!;
  await s.wallets.startConnect(walletId, { perOrder: '20', daily: '50' });
  s.pp.approveSetup((await s.wallets.get(walletId)).setupTokenId!);
  const { pairingCode } = await s.wallets.finishConnect(walletId);
  await s.call('wallet_status', { wallet_key: connect.data.wallet_key, claim_code: pairingCode }, s.buyer);

  const cart = await s.call('create_cart', { items: [{ variant_id: 'var_bowl_sand', quantity: 1 }], shipping_address: address }, s.buyer);
  const paid = await s.call('pay_with_paypal', { cart_id: cart.data.cart_id, wallet_key: connect.data.wallet_key }, s.buyer);
  assert.equal(paid.data.status, 'needs_buyer_approval');
  assert.match(paid.data.approval_url, /checkoutnow/);

  assert.deepEqual(await s.guard.list(walletId, { status: 'pending_approval' }), [], 'no request the buyer could never answer');
  assert.deepEqual(s.approvals, [], 'the shop owner is not asked about a buyer\'s limits');
});

// ---- Guard on its own, with a fake executor ----

function refundAction(amount: number): ProposedAction {
  const actor = { type: 'agent' as const, id: 'agent:laptop:key_1', side: 'merchant' as const };
  return { kind: 'refund.create', actor, ownerId: 'shop_x', amount, currency: 'USD', resourceId: 'CAP-1', reason: 'Chipped', params: { orderId: 'O-1' } };
}

function guardWith(policy: Policy, clock = { now: new Date('2026-11-10T12:00:00Z') }) {
  const executed: string[] = [];
  const executor: Executor = {
    simulate: async (action) => ({ ok: true, effects: [`Refund ${action.amount}`], blockers: [], amount: action.amount }),
    execute: async (_action, key) => {
      executed.push(key);
      return { refund_id: `REF-${executed.length}` };
    },
    verify: async () => ({ ok: true, detail: 'COMPLETED' }),
  };
  const guard = new Guard({ store: new MemoryGuardStore(), executors: { 'refund.create': executor }, policyFor: async () => policy, now: () => clock.now });
  return { guard, executed, clock };
}

test('the same refund twice is refused even when the owner\'s rules have no duplicate check', async () => {
  const { guard, executed } = guardWith({ ownerId: 'shop_x', currency: 'USD', rules: [] });
  assert.equal((await guard.submit(refundAction(1_500))).status, 'verified');
  const again = await guard.submit(refundAction(1_500));
  assert.equal(again.status, 'denied');
  assert.equal(again.decision?.hits[0].ruleId, 'built-in:duplicate');
  assert.equal(executed.length, 1);
});

test('a duplicate window longer than a day still sees older records', async () => {
  const policy: Policy = { ownerId: 'shop_x', currency: 'USD', rules: [{ id: 'two-days', type: 'no_duplicates', kinds: ['refund.create'], windowMinutes: 2 * 24 * 60 }] };
  const { guard, clock } = guardWith(policy);
  await guard.submit(refundAction(1_500));
  clock.now = new Date(clock.now.getTime() + 30 * 3_600_000);
  const later = await guard.submit(refundAction(1_500));
  assert.equal(later.status, 'denied');
  assert.equal(later.decision?.hits[0].ruleId, 'two-days');
});

test('two approvals of the same request at once run it once', async () => {
  const policy: Policy = { ownerId: 'shop_x', currency: 'USD', rules: [{ id: 'ask', type: 'always_approve', kinds: ['refund.create'] }] };
  const { guard, executed } = guardWith(policy);
  const pending = await guard.submit(refundAction(1_500));
  const results = await Promise.allSettled([guard.approve(pending.id, 'owner:shop_x'), guard.approve(pending.id, 'owner:shop_x')]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(executed.length, 1);
});

test('amounts people and models type are parsed strictly', () => {
  assert.equal(parseAmount('$1,250.50', 'USD'), 125_050);
  assert.equal(parseAmount('62', 'USD'), 6_200);
  assert.equal(parseAmount(62.5, 'USD'), 6_250);
  assert.equal(parseAmount('40 USD', 'USD'), 4_000);
  assert.equal(parseAmount('1500', 'JPY'), 1_500);
  for (const bad of ['-5', '12,50', '1.234', 'lots', '', '1,2345']) assert.equal(parseAmount(bad, 'USD'), undefined, bad);
  assert.equal(parseAmount('15.5', 'JPY'), undefined, 'yen has no decimals');
  assert.equal(parseAmount(24.555, 'USD'), undefined, 'a number with a fraction of a cent is refused, not rounded');
});

test('editing a price keeps stock a checkout just took, and bad edits change nothing', async () => {
  const s = await stack();
  const { cartId, token } = await approvedCart(s, [{ variant_id: 'var_mug_sage', quantity: 2 }]);
  await pay(s, cartId, token);
  await s.shops.setVariant('shop_maya', 'var_mug_sage', { price: 3_600 });
  assert.equal(await stock(s, 'var_mug_sage'), 4, 'the sale is not undone by the edit');

  await assert.rejects(s.shops.setVariant('shop_maya', 'var_mug_sage', { inventory: -1 }), /whole number/);
  await assert.rejects(s.shops.setVariant('shop_maya', 'var_nope', { price: 100 }), /not found/);
  const row = variantRows((await s.catalogs.byShopId('shop_maya'))!).find((r) => r.id === 'var_mug_sage');
  assert.deepEqual([row?.price, row?.stock], [3_600, 4]);
  const vase = variantRows((await s.catalogs.byShopId('shop_maya'))!).find((r) => r.id === 'var_vase_custom');
  assert.equal(vase?.stock, null, 'made-to-order has no stock to edit');
});

test('market prices: the middle half sets the range, odd listings and other currencies are left out', () => {
  const at = (price: number, store = `s${price}.com`, currency = 'USD') => ({ title: `Mug ${price}`, store, price, currency, url: `https://${store}` });
  const listings = [at(2_200), at(2_800), at(3_200), at(3_600), at(4_200), at(17_100), at(3_200, 'eu.com', 'EUR'), at(2_800)];
  const ref = priceReference('stoneware mug', listings, 'USD', 3_400);
  assert.equal(ref.listings, 6, 'duplicate and EUR listings dropped');
  assert.equal(ref.median, 3_400);
  assert.equal(ref.position, 'within');
  assert.ok(ref.high! < 10_000, 'the $171 set does not stretch the range');
  assert.match(ref.summary, /\$34\.00 is within the usual range/);
  assert.equal(priceReference('rare thing', [at(1_000)], 'USD', 900).median, undefined, 'too few listings, no range');
});

test('the owner\'s agent can check a price against the market, read-only', async () => {
  const s = await stack();
  const source = { search: async () => [2_400, 2_600, 2_900, 3_100, 3_300].map((p) => ({ title: `Mug ${p}`, store: `s${p}.com`, price: p, currency: 'USD', url: 'https://x' })) };
  s.services.market = new MarketPrices(source);
  const check = await s.call('price_check', { variant_id: 'var_mug_sage' }, s.owner);
  assert.equal(check.data.your_price_is, 'above');
  assert.equal(check.data.median, '$29.00');
  assert.equal(await stock(s, 'var_mug_sage'), 6, 'nothing in the shop changed');
  const notForBuyers = await s.call('price_check', { variant_id: 'var_mug_sage' }, s.buyer);
  assert.equal(notForBuyers.isError, true);
});

test('Channel3 listings: one per product, its cheapest in-stock offer, in minor units', async () => {
  const body = {
    products: [
      { id: 'a', title: 'Mug A', offers: [{ url: 'u1', domain: 'one.com', price: { price: 30, currency: 'USD' }, availability: 'InStock' }, { url: 'u2', domain: 'two.com', price: { price: 24.5, currency: 'USD' }, availability: 'InStock' }] },
      { id: 'b', title: 'Mug B', offers: [{ url: 'u3', domain: 'three.com', price: { price: 12, currency: 'USD' }, availability: 'OutOfStock' }] },
    ],
  };
  const fetchStub = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  const listings = await new Channel3('key', fetchStub).search('mug', 10);
  assert.deepEqual(listings, [{ title: 'Mug A', store: 'two.com', price: 2_450, currency: 'USD', url: 'u2' }]);
});

test('a failed market search is not cached: the next question tries again', async () => {
  let calls = 0;
  const flaky = {
    search: async () => {
      calls += 1;
      if (calls === 1) throw new Error('timeout');
      return [2_400, 2_600, 2_900].map((p) => ({ title: `Mug ${p}`, store: `s${p}.com`, price: p, currency: 'USD', url: 'https://x' }));
    },
  };
  const s = await stack();
  const market = new MarketPrices(flaky);
  const catalog = (await s.catalogs.byShopId('shop_maya'))!;
  await assert.rejects(market.forVariant(catalog, 'var_mug_sage'), /unavailable/);
  assert.equal((await market.forVariant(catalog, 'var_mug_sage')).median, 2_600);
  await market.forVariant(catalog, 'var_mug_sage');
  assert.equal(calls, 2, 'the good answer is cached');
});

test('the email a buyer types into a cart is not who paid: trust rules use PayPal\'s payer', async () => {
  const s = await stack();
  const cart = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address, customer: { email_address: 'trusted@example.com' } }, s.buyer);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token); // PayPal's payer is buyer@example.com
  await pay(s, cart.data.cart_id, token);

  const invoice = await s.call('send_invoice', { email: 'trusted@example.com', items: [{ name: 'Vase', price: '30.00' }] }, s.owner);
  assert.equal(invoice.data.status, 'pending_approval', 'still a new client: they never paid');
  const known = await s.call('send_invoice', { email: 'buyer@example.com', items: [{ name: 'Vase', price: '30.00' }] }, s.owner);
  assert.equal(known.data.status, 'verified', 'the real payer is a known client');
});
