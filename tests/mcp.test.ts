import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { handleMcp } from '../src/core/mcp.ts';
import { address, stack } from './stack.ts';

/** Buyer agent buys one mug through the MCP tools and pays; returns the order id. */
async function buyMug(s: Awaited<ReturnType<typeof stack>>, variant = 'var_mug_sage', quantity = 1) {
  const cart = await s.call('create_cart', { items: [{ variant_id: variant, quantity }], shipping_address: address }, s.buyer);
  assert.equal(cart.isError, false, cart.text);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  await s.commerce.checkout(cart.data.cart_id, { items: [], payment_method: { type: 'paypal', token } });
  return cart.data.cart_id as string;
}

test('MCP handshake: buyer endpoint lists buyer tools, an agent key adds seller tools', async () => {
  const s = await stack();
  const init = (await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { services: s.services, channel: 't', ...s.buyer })) as any;
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);

  const list = async (ctx: object) =>
    ((await handleMcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { services: s.services, channel: 't', ...ctx })) as any).result.tools.map((t: { name: string }) => t.name);
  const buyerTools = await list(s.buyer);
  assert.deepEqual(buyerTools, ['search_products', 'create_cart', 'update_cart', 'get_cart', 'request_refund', 'connect_paypal', 'wallet_status', 'pay_with_paypal']);
  const sellerTools = await list(s.owner);
  assert.ok(sellerTools.includes('refund_order') && sellerTools.includes('propose_policy'));
  assert.ok(!sellerTools.some((n: string) => /approve|decide/.test(n)), 'no tool can approve a say-so request');

  assert.equal(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, { services: s.services, channel: 't' }), undefined);
  const unknown = (await handleMcp({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, { services: s.services, channel: 't' })) as any;
  assert.equal(unknown.error.code, -32601);
});

test('buyer agent: search, hit a stock issue, fix it, get a PayPal link', async () => {
  const s = await stack();
  const found = await s.call('search_products', { query: 'mug', in_stock_only: true }, s.buyer);
  const variants = found.data.products[0].variants.map((v: { variant_id: string }) => v.variant_id);
  assert.deepEqual(variants, ['var_mug_speckled', 'var_mug_sage'], 'sold-out Midnight Blue is hidden');

  const first = await s.call('create_cart', { items: [{ variant_id: 'var_mug_speckled', quantity: 2 }], shipping_address: address }, s.buyer);
  assert.equal(first.data.status, 'INCOMPLETE');
  assert.equal(first.data.approval_url, undefined);
  assert.equal(first.data.validation_issues[0].code, 'INVENTORY_ISSUE');

  const fixed = await s.call('update_cart', { cart_id: first.data.cart_id, items: [{ variant_id: 'var_mug_speckled', quantity: 1 }], shipping_address: address }, s.buyer);
  assert.equal(fixed.data.status, 'READY');
  assert.match(fixed.data.approval_url, /checkoutnow/);
});

test('tool inputs are validated before anything runs', async () => {
  const s = await stack();
  const bad = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 0 }] }, s.buyer);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /quantity must be at least 1/);

  const noKey = await s.call('refund_order', { order_id: 'x', reason: 'because' }, s.buyer);
  assert.equal(noKey.isError, true);
  assert.match(noKey.text, /agent key/);
});

test("owner's agent: small refund runs, big refund waits, and only the owner can approve", async () => {
  const s = await stack();
  const orderId = await buyMug(s, 'var_mug_sage', 2); // $68 + $8.95 shipping + $4.08 tax = $81.03

  const orders = await s.call('list_orders', { status: 'paid' }, s.owner);
  assert.equal(orders.data.length, 1);

  const number = (await s.call('get_order', { order_id: orderId }, s.owner)).data.number;
  assert.match(number, /^SAY-/);
  const small = await s.call('refund_order', { order_id: number.toLowerCase(), amount: '10.00', reason: 'Small chip on the rim' }, s.owner); // order numbers work too
  assert.equal(small.data.status, 'verified');

  const big = await s.call('refund_order', { order_id: orderId, amount: '60.00', reason: 'Both arrived broken' }, s.owner);
  assert.equal(big.data.status, 'pending_approval');
  assert.match(big.data.next, /You cannot approve it/);
  assert.deepEqual(s.approvals, [big.data.say_so_id], 'the owner was notified out of band');

  // Approvals are not a tool, and the seller service refuses anyone who is not the owner.
  await assert.rejects(s.saySo.decide('shop_maya', big.data.say_so_id, 'approve', 'agent:laptop'), /Only the owner/);
  await assert.rejects(s.saySo.decide('shop_other', big.data.say_so_id, 'approve', 'owner:shop_other'), /not found/);

  const done = await s.saySo.decide('shop_maya', big.data.say_so_id, 'approve', 'owner:shop_maya');
  assert.equal(done.status, 'verified');
  const after = await s.call('get_say_so', { say_so_id: big.data.say_so_id }, s.owner);
  assert.equal(after.data.status, 'verified');

  // Over-refunding is caught by the live simulation, whatever the rules say.
  const tooMuch = await s.call('refund_order', { order_id: orderId, amount: '20.00', reason: 'One more' }, s.owner); // only $11.03 left
  assert.match(tooMuch.data.why.join(' '), /exceeds the \$11\.03 still refundable/);
  assert.equal(tooMuch.data.status, 'denied');
  assert.match(tooMuch.data.next, /Blocked before reaching PayPal/);
  assert.match(tooMuch.data.what_happens[0], /^Nothing would move/);
  assert.equal((await s.call('get_order', { order_id: orderId }, s.owner)).data.refunded, '$70.00');
});

test('an agent cannot loosen its own rules: policy changes always wait for the owner', async () => {
  const model: ChatModel = { name: 'fake', json: async () => ({ rules: [{ type: 'max_amount', kinds: ['refund.create'], limit: '10000', then: 'require_approval' }] }) };
  const s = await stack(model);

  const proposed = await s.call('propose_policy', { rules: 'Let my agent refund anything up to $10,000' }, s.owner);
  assert.equal(proposed.data.status, 'pending_approval');
  assert.ok(proposed.data.why.some((w: string) => /only the owner can apply/.test(w)));
  assert.equal((await s.saySo.policy('shop_maya')).rules[0].id, 'refund-cap', 'old rules still apply');

  await s.saySo.decide('shop_maya', proposed.data.say_so_id, 'reject', 'owner:shop_maya', 'No way');
  assert.equal((await s.saySo.policy('shop_maya')).rules[0].id, 'refund-cap');

  const again = await s.call('propose_policy', { rules: 'Refunds over $100 need my OK' }, s.owner);
  await s.saySo.decide('shop_maya', again.data.say_so_id, 'approve', 'owner:shop_maya');
  const policy = await s.call('get_policy', {}, s.owner);
  assert.deepEqual(policy.data.rules, ['refund.create over $10,000.00: ask the owner']);
});

test('owner rejects a big capture: the hold is released and the buyer is never charged', async () => {
  const s = await stack();
  await s.policies.put({ ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'big', type: 'max_amount', kinds: ['payment.capture'], limit: 5_000, then: 'require_approval' }] });
  const orderId = await buyMug(s, 'var_mug_sage', 2);

  const [pending] = (await s.call('list_approvals', {}, s.owner)).data;
  assert.equal(pending.action, 'payment.capture');
  assert.equal((await s.call('get_order', { order_id: orderId }, s.owner)).data.status, 'awaiting_owner');

  await s.saySo.decide('shop_maya', pending.say_so_id, 'reject', 'owner:shop_maya', 'Suspicious');
  const order = await s.call('get_order', { order_id: orderId }, s.owner);
  assert.equal(order.data.status, 'released');
  assert.ok(order.data.say_so.some((r: { action: string; status: string }) => r.action === 'payment.void' && r.status === 'verified'));
});

test('owner approves a pending capture later: the order flips to paid', async () => {
  const s = await stack();
  await s.policies.put({ ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'big', type: 'max_amount', kinds: ['payment.capture'], limit: 5_000, then: 'require_approval' }] });
  const orderId = await buyMug(s, 'var_mug_sage', 2);
  const [pending] = await s.saySo.pending('shop_maya');
  await s.saySo.decide('shop_maya', pending.id, 'approve', 'owner:shop_maya');
  assert.equal((await s.call('get_order', { order_id: orderId }, s.owner)).data.status, 'paid');
});

test('tracking and stock updates from the agent', async () => {
  const s = await stack();
  const orderId = await buyMug(s);
  const tracked = await s.call('add_tracking', { order_id: orderId, carrier: 'usps', tracking_number: '9400111899223' }, s.owner);
  assert.equal(tracked.data.tracking.carrier, 'USPS');
  assert.equal(s.pp.tracking[0].tracking_number, '9400111899223');

  const restock = await s.call('update_variant', { variant_id: 'var_mug_midnight', stock: 4, price: '38.00' }, s.owner);
  assert.deepEqual(restock.data, { variant_id: 'var_mug_midnight', title: 'Midnight Blue', price: '$38.00', in_stock: 4 });
});

test('agent keys: hashed, scoped to one shop, revocable; owner sessions are signed', async () => {
  const s = await stack();
  const key = await s.access.agentFromHeader('Bearer sk_agent_demo');
  assert.equal(key?.shopId, 'shop_maya');
  assert.equal(await s.access.agentFromHeader('Bearer sk_owner_demo'), undefined, 'the owner secret is not an agent key');
  assert.ok((await s.access.listKeys('shop_maya')).every((k) => !JSON.stringify(k).includes('sk_agent_demo')), 'keys are stored hashed');

  await s.access.revokeKey('shop_maya', key!.id);
  assert.equal(await s.access.agentFromHeader('Bearer sk_agent_demo'), undefined);

  const session = s.access.signOwnerSession('shop_maya', 60_000);
  assert.deepEqual(s.access.verifyOwnerSession(session), { shopId: 'shop_maya', kind: 'owner' });
  assert.equal(s.access.verifyOwnerSession(session.replace('.owner.', '.demo.')), undefined, 'the kind is signed too');
  assert.equal(s.access.verifyOwnerSession(session.replace('shop_maya', 'shop_evil')), undefined);
  assert.equal(s.access.verifyOwnerSession(session, Date.now() + 120_000), undefined, 'expired');
});

test('onboarding: a new shop starts as a draft, and publishing registers it with PayPal', async () => {
  const model: ChatModel = {
    name: 'fake',
    json: async () => ({ shop: { name: 'Lumen Candles' }, products: [{ name: 'Soy Candle', variants: [{ title: 'Lavender', price: '18.00', quantity: 5 }] }] }),
  };
  const s = await stack(model);
  const { catalog, ownerSecret, agentKey } = await s.shops.onboard({ text: 'Soy candles, $18' });
  assert.ok(ownerSecret.startsWith('sk_owner_') && agentKey.startsWith('sk_agent_'));
  assert.ok(await s.access.checkOwnerSecret(catalog.shop.id, ownerSecret));

  const closed = await s.call('search_products', {}, { shopSlug: catalog.shop.slug });
  assert.equal(closed.isError, true, 'drafts are invisible to buyer agents');

  await s.shops.publish(catalog.shop.id);
  assert.equal(s.pp.catalogProducts[0].name, 'Soy Candle');
  const open = await s.call('search_products', {}, { shopSlug: catalog.shop.slug });
  assert.equal(open.data.products[0].variants[0].price, '$18.00');

  // The new shop's key can't touch the demo shop.
  const theirs = await s.access.agentFromHeader(`Bearer ${agentKey}`);
  const orders = await s.call('list_orders', {}, { agent: { shopId: theirs!.shopId, keyId: theirs!.id, label: theirs!.label } });
  assert.deepEqual(orders.data, []);
});

test("buyer's assistant: follows the order, asks for a refund, and the owner always decides", async () => {
  const s = await stack();
  const cartId = await buyMug(s); // $44.99, well under the $50 refund limit the owner's own agent has
  await s.call('add_tracking', { order_id: cartId, carrier: 'USPS', tracking_number: '9400111899223' }, s.owner);

  const paid = await s.call('get_cart', { cart_id: cartId }, s.buyer);
  assert.equal(paid.data.order.payment, 'Charged. The shop is preparing the order.');
  assert.deepEqual(paid.data.order.tracking, { carrier: 'USPS', number: '9400111899223' });
  assert.equal(paid.data.order.refunded, 'nothing');

  const asked = await s.call('request_refund', { cart_id: cartId, amount: '10.00', reason: 'Arrived with a chipped rim' }, s.buyer);
  assert.equal(asked.data.status, 'waiting for the shop owner', 'even a small buyer request waits for the owner');
  assert.equal(s.approvals.length, 1, 'the owner was notified');

  const again = await s.call('request_refund', { cart_id: cartId, reason: 'Please hurry' }, s.buyer);
  assert.equal(again.data.request_id, asked.data.request_id, 'no duplicate requests while one is open');

  const [pending] = await s.saySo.pending('shop_maya');
  assert.equal(pending.action.actor.side, 'buyer');
  assert.ok(pending.decision?.hits.some((h) => h.ruleId === 'built-in:buyer-request'));
  await s.saySo.decide('shop_maya', pending.id, 'approve', 'owner:shop_maya');

  const after = await s.call('get_cart', { cart_id: cartId }, s.buyer);
  assert.equal(after.data.order.refunded, '$10.00');
  assert.equal(after.data.order.refund_requests[0].status, 'refunded through PayPal');
  assert.ok(!JSON.stringify(after.data).includes('CAP'), "PayPal capture ids stay with the shop");

  const unpaid = await s.call('create_cart', { items: [{ variant_id: 'var_bowl_sand', quantity: 1 }], shipping_address: address }, s.buyer);
  const nope = await s.call('request_refund', { cart_id: unpaid.data.cart_id, reason: 'Changed my mind' }, s.buyer);
  assert.equal(nope.isError, true);
  assert.match(nope.text, /not been charged/);
});

test('all-shops endpoint: one MCP URL searches every shop, carts are per shop', async () => {
  const model: ChatModel = {
    name: 'fake',
    json: async () => ({ shop: { name: 'Lumen Candles' }, products: [{ name: 'Soy Candle', category: 'home/decor', variants: [{ title: 'Lavender', price: '18.00', quantity: 5 }] }] }),
  };
  const s = await stack(model);
  const { catalog } = await s.shops.onboard({ text: 'Soy candles, $18' });
  const market = { marketplace: true };

  const draftHidden = await s.call('list_shops', {}, market);
  assert.deepEqual(draftHidden.data.map((x: { shop: string }) => x.shop), ['maya-ceramics'], 'drafts are not listed');
  await s.shops.publish(catalog.shop.id);

  const shops = await s.call('list_shops', {}, market);
  assert.equal(shops.data.length, 2);
  const candles = await s.call('search_products', { query: 'candle' }, market);
  assert.deepEqual(candles.data.results.map((r: { shop: string }) => r.shop), [catalog.shop.slug]);
  const everything = await s.call('search_products', {}, market);
  assert.equal(everything.data.results.length, 2);

  const noShop = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }] }, market);
  assert.equal(noShop.isError, true);
  assert.match(noShop.text, /Pass `shop`/);

  const cart = await s.call('create_cart', { shop: 'maya-ceramics', items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, market);
  assert.equal(cart.data.shop, 'maya-ceramics');
  assert.match(cart.data.approval_url, /checkoutnow/);
  assert.equal((await s.call('get_cart', { cart_id: cart.data.cart_id }, market)).data.status, 'CREATED');

  // A shop's own endpoint still only sees its own carts, and list_shops stays on the all-shops endpoint.
  const elsewhere = await s.call('get_cart', { cart_id: cart.data.cart_id }, { shopSlug: catalog.shop.slug });
  assert.equal(elsewhere.isError, true);
  assert.equal((await s.call('list_shops', {}, s.buyer)).isError, true);
});

test("saved PayPal: the buyer approves once and sets limits; the assistant pays alone inside them", async () => {
  const s = await stack();
  const connect = await s.call('connect_paypal', { assistant_name: 'ChatGPT' }, s.buyer);
  assert.match(connect.data.wallet_key, /^sk_wallet_/);
  const walletId = connect.data.connect_url.split('/').pop();

  // Not connected yet: paying needs the buyer to finish first.
  const early = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, s.buyer);
  const notYet = await s.call('pay_with_paypal', { cart_id: early.data.cart_id, wallet_key: connect.data.wallet_key }, s.buyer);
  assert.equal(notYet.isError, true);
  assert.match(notYet.text, /isn't connected yet/);

  // The person picks limits on Sayso's page, then approves in PayPal.
  await s.wallets.startConnect(walletId, { perOrder: '50', daily: '80' });
  const pending = await s.wallets.get(walletId);
  s.pp.approveSetup(pending.setupTokenId!);
  const { wallet, connectorKey } = await s.wallets.finishConnect(walletId);
  assert.equal(wallet.status, 'connected');
  assert.match(connectorKey!, /^sk_wallet_/);
  assert.equal((await s.wallets.fromKey(connectorKey))?.id, walletId, 'the personal URL key opens the same wallet');
  assert.equal((await s.wallets.finishConnect(walletId)).connectorKey, undefined, 'shown once');
  assert.equal(wallet.payerEmail, 'buyer@example.com');
  await assert.rejects(s.wallets.startConnect(walletId, { perOrder: '2000', daily: '2000' }), /already connected/, 'limits are fixed once connected');

  // $44.99 is inside the $50 limit: paid with no link, and the shop's Guard still captured it.
  const paid = await s.call('pay_with_paypal', { cart_id: early.data.cart_id }, { ...s.buyer, walletKey: connect.data.wallet_key });
  assert.equal(paid.data.status, 'paid', paid.text);
  assert.equal(paid.data.order.payment, 'Charged. The shop is preparing the order.');
  const order = (await s.call('list_orders', {}, s.owner)).data.find((o: { id: string }) => o.id === early.data.cart_id);
  assert.equal(order.status, 'paid');

  // Two mugs ($68 + shipping) is over $50 a order: nothing charged, the buyer approves this one.
  const big = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 2 }], shipping_address: address }, s.buyer);
  const over = await s.call('pay_with_paypal', { cart_id: big.data.cart_id, wallet_key: connect.data.wallet_key }, s.buyer);
  assert.equal(over.data.status, 'needs_buyer_approval');
  assert.match(over.data.approval_url, /checkoutnow/);
  assert.ok(over.data.why.some((w: string) => /over the \$50\.00 limit/.test(w)));
  assert.notEqual((await s.call('get_cart', { cart_id: big.data.cart_id }, s.buyer)).data.status, 'COMPLETED', 'not paid');

  // Daily limit: another $44.99 today would make $89.98, over $80.
  const second = await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, s.buyer);
  const daily = await s.call('pay_with_paypal', { cart_id: second.data.cart_id, wallet_key: connect.data.wallet_key }, s.buyer);
  assert.equal(daily.data.status, 'needs_buyer_approval');
  assert.ok(daily.data.why.some((w: string) => /daily limit/.test(w)));

  // Disconnecting forgets the PayPal token; the key stops paying.
  await s.wallets.disconnect(walletId);
  assert.equal(s.pp.paymentTokens.size, 0);
  const gone = await s.call('pay_with_paypal', { cart_id: second.data.cart_id, wallet_key: connect.data.wallet_key }, s.buyer);
  assert.equal(gone.isError, true);

  // Every key issued before stays dead, even after the buyer connects PayPal again.
  await s.wallets.startConnect(walletId, { perOrder: '50', daily: '80' });
  s.pp.approveSetup((await s.wallets.get(walletId)).setupTokenId!);
  const again = await s.wallets.finishConnect(walletId);
  assert.equal(await s.wallets.fromKey(connect.data.wallet_key), undefined);
  assert.equal(await s.wallets.fromKey(connectorKey), undefined, 'a leaked personal URL does not come back');
  assert.equal((await s.wallets.fromKey(again.connectorKey))?.id, walletId, 'the new personal URL works');
});

test('custom orders: invoices go through Guard, a first invoice to a new client waits for the owner', async () => {
  const s = await stack();
  const vase = { email: 'Grace@Example.com', name: 'Grace', items: [{ name: 'Custom bud vase, cobalt glaze', price: '62.00' }], note: 'Ships in about 10 days', deposit: '31.00' };

  const first = await s.call('send_invoice', vase, s.owner);
  assert.equal(first.data.status, 'pending_approval', 'Grace has never paid this shop');
  assert.ok(first.data.why.some((w: string) => /never paid you before/.test(w)));
  assert.equal(s.pp.invoices.size, 0, 'nothing sent before the owner says OK');

  const done = await s.saySo.decide('shop_maya', first.data.say_so_id, 'approve', 'owner:shop_maya');
  assert.equal(done.status, 'verified');
  const [invoice] = [...s.pp.invoices.values()];
  assert.equal(invoice.status, 'SENT');
  assert.equal(invoice.primary_recipients[0].billing_info.email_address, 'grace@example.com');
  assert.deepEqual(invoice.configuration.partial_payment.minimum_amount_due, { currency_code: 'USD', value: '31.00' });

  // Once Grace has paid, she is a known client and the next invoice goes out on its own.
  s.pp.payInvoice(invoice.id);
  const second = await s.call('send_invoice', { email: 'grace@example.com', items: [{ name: 'Matching saucer', price: '18.00' }] }, s.owner);
  assert.equal(second.data.status, 'verified', second.text);
  assert.match(second.data.invoice.payer_url, /invoice/);

  // Over $200 still asks; the same invoice twice within the hour is blocked.
  const big = await s.call('send_invoice', { email: 'grace@example.com', items: [{ name: 'Dinner set', price: '240.00' }] }, s.owner);
  assert.equal(big.data.status, 'pending_approval');
  const again = await s.call('send_invoice', { email: 'grace@example.com', items: [{ name: 'Matching saucer', price: '18.00' }] }, s.owner);
  assert.equal(again.data.status, 'denied');

  const list = await s.call('list_invoices', {}, s.owner);
  const paid = list.data.find((i: { say_so_id: string }) => i.say_so_id === first.data.say_so_id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.total, '$62.00');
  assert.equal(list.data.find((i: { say_so_id: string }) => i.say_so_id === big.data.say_so_id).status, 'waiting for the owner');

  const bad = await s.call('send_invoice', { email: 'not-an-email', items: [{ name: 'Vase', price: '10.00' }] }, s.owner);
  assert.equal(bad.data.status, 'denied', 'the simulation catches a bad address before PayPal');
});
