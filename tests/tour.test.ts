// The judges' tour: each visit gets a private copy of the demo shop, the scripted agents go through the
// same tools and Guard as everyone else, and nothing they do is approved for the judge.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { ownerActor } from '../src/core/actors.ts';
import { MemoryTourStore, Tours } from '../src/core/tour.ts';
import { stack } from './stack.ts';

type Stack = Awaited<ReturnType<typeof stack>>;

/** A buyer approved saved PayPal once; tours lend that approval. */
async function lender(s: Stack): Promise<string> {
  const connect = await s.call('connect_paypal', { assistant_name: 'Tour' }, { shopSlug: 'maya-ceramics' });
  const walletId = new URL(connect.data.connect_url).pathname.split('/').pop()!;
  await s.wallets.startConnect(walletId, { perOrder: '100', daily: '250' });
  s.pp.approveSetup((await s.wallets.get(walletId)).setupTokenId!);
  await s.wallets.finishConnect(walletId);
  return walletId;
}

function tours(s: Stack, lendFrom?: string) {
  const store = new MemoryTourStore();
  return { store, tours: new Tours({ store, catalogs: s.catalogs, access: s.access, wallets: s.wallets, saySo: s.saySo, tools: s.services, template: demoCatalog, lendFrom }) };
}

test('the tour walks the whole flow, and every money step waits for the judge', async () => {
  const s = await stack();
  const { tours: t } = tours(s, await lender(s));
  const tour = await t.start();

  assert.match(tour.slug, /^maya-ceramics-/);
  assert.deepEqual(await s.call('list_shops', {}, { marketplace: true }).then((r) => r.data.map((x: { shop: string }) => x.shop)), ['maya-ceramics'], 'tour copies are not listed');

  const buy = await t.run(tour.shopId, 'buy');
  assert.match(buy.transcript[1].said, /Only 1 left/);
  assert.match(buy.transcript.at(-1)!.said, /Paid with the buyer's saved PayPal/);
  const { order } = await s.orders.get(tour.shopId, buy.cartId!);
  assert.equal(order.status, 'paid');

  const refund = await t.run(tour.shopId, 'refund');
  assert.equal((await s.guard.get(refund.recordId!))?.status, 'pending_approval', 'over the $50 rule: the judge decides');

  const rules = await t.run(tour.shopId, 'rules');
  const rulesRecord = await s.guard.get(rules.recordId!);
  assert.equal(rulesRecord?.status, 'pending_approval');
  assert.ok(rulesRecord?.decision?.hits.some((h) => h.ruleId === 'built-in:human-only'), 'an agent can never apply its own rules');

  const commission = await t.run(tour.shopId, 'commission');
  assert.equal((await s.guard.get(commission.recordId!))?.status, 'pending_approval', 'a first invoice to a new client');

  assert.deepEqual(await t.run(tour.shopId, 'buy'), buy, 'a step runs once; asking again shows what happened');
});

test('two judges never share stock or orders', async () => {
  const s = await stack();
  const { tours: t } = tours(s, await lender(s));
  const [a, b] = [await t.start(), await t.start()];
  await t.run(a.shopId, 'buy');
  const second = await t.run(b.shopId, 'buy');
  assert.match(second.transcript.at(-1)!.said, /Paid/, 'the second judge still finds the last speckled mug');
  assert.equal((await s.orders.list(a.shopId)).length, 1);
});

test('without saved PayPal to lend, the buyer gets a PayPal link instead', async () => {
  const s = await stack();
  const { tours: t } = tours(s);
  const tour = await t.start();
  const buy = await t.run(tour.shopId, 'buy');
  assert.match(buy.approvalUrl!, /checkoutnow/);
  await assert.rejects(t.run(tour.shopId, 'refund'), /not been charged/, 'until the judge pays in PayPal; the step can be run again after');
  await assert.rejects(t.run('shop_nope', 'buy'), /not found/);
});

test('a refund needs the purchase first, and expired tours are swept away', async () => {
  const s = await stack();
  const { tours: t, store } = tours(s, await lender(s));
  const tour = await t.start(new Date(Date.now() - 2 * 86_400_000));
  await assert.rejects(t.run(tour.shopId, 'refund'), /purchase first/);

  assert.equal(await t.sweep(), 1);
  assert.equal(await s.catalogs.byShopId(tour.shopId), undefined);
  assert.equal(await store.byShop(tour.shopId), undefined);
  assert.equal((await s.access.listKeys(tour.shopId)).every((k) => k.revokedAt), true);
  assert.equal(s.pp.paymentTokens.size, 1, "the lender's PayPal approval is never deleted");
});

test('the agent earns autonomy: the judge approves three held refunds, then adopts the rule they support', async () => {
  const s = await stack();
  const { tours: t } = tours(s, await lender(s));
  const tour = await t.start();

  const earn = await t.run(tour.shopId, 'earn');
  assert.equal((await s.orders.get(tour.shopId, earn.cartId!)).order.status, 'paid', 'its own order, paid with saved PayPal');
  assert.equal(earn.recordIds?.length, 3);
  for (const id of earn.recordIds!) {
    assert.equal((await s.guard.get(id))?.status, 'pending_approval', 'each refund is over the $50 rule');
    await s.saySo.decide(tour.shopId, id, 'approve', `owner:${tour.shopId}`);
  }

  const [suggestion] = (await s.saySo.autonomy(tour.shopId)).suggestions;
  assert.match(suggestion.title, /refunds up to \$60\.00 on its own/);
  await s.saySo.adoptSuggestion(tour.shopId, suggestion.id, ownerActor(tour.shopId));
  const cap = (await s.saySo.policy(tour.shopId)).rules.find((r) => r.id === 'refund-cap') as { limit: number };
  assert.equal(cap.limit, 6_000);
});

test('an old rule proposal approved after the rules changed is refused, not applied over them', async () => {
  const s = await stack();
  const { tours: t } = tours(s, await lender(s));
  const tour = await t.start();

  const rules = await t.run(tour.shopId, 'rules'); // the agent asks for $10,000 refunds; it waits
  const earn = await t.run(tour.shopId, 'earn');
  for (const id of earn.recordIds!) await s.saySo.decide(tour.shopId, id, 'approve', `owner:${tour.shopId}`);
  const [suggestion] = (await s.saySo.autonomy(tour.shopId)).suggestions;
  await s.saySo.adoptSuggestion(tour.shopId, suggestion.id, ownerActor(tour.shopId));

  const late = await s.saySo.decide(tour.shopId, rules.recordId!, 'approve', `owner:${tour.shopId}`);
  assert.equal(late.status, 'failed');
  assert.match(JSON.stringify(late.events.at(-1)), /rules changed since this was proposed/);
  const cap = (await s.saySo.policy(tour.shopId)).rules.find((r) => r.id === 'refund-cap') as { limit: number };
  assert.equal(cap.limit, 6_000, 'the earned rule is still in force');
});

/** A shop a judge opened from photos: their own pieces and prices, published. */
async function judgeShop(s: Stack): Promise<string> {
  const catalog = structuredClone(demoCatalog);
  const shopId = 'shop_judge_1';
  catalog.shop = { ...catalog.shop, id: shopId, slug: 'clay-corner', name: 'Clay Corner', status: 'live' };
  catalog.products = [
    {
      ...catalog.products[0],
      id: 'prod_cup',
      shopId,
      name: 'Tea cup',
      variants: [{ ...catalog.products[0].variants[0], id: 'var_cup', productId: 'prod_cup', title: 'Ash glaze', price: 2_200, inventory: 5, madeToOrderDays: undefined }],
    },
  ];
  await s.catalogs.save(catalog);
  return shopId;
}

test("on a judge's own shop: an assistant buys, the refund and the rule change wait for the judge, and it closes after two days", async () => {
  const s = await stack();
  const { tours: t, store } = tours(s, await lender(s));
  const shopId = await judgeShop(s);
  const now = new Date();
  const tour = await t.adopt(shopId, now);
  assert.equal(tour.kind, 'seller');
  assert.equal((await s.catalogs.byShopId(shopId))?.shop.expiresAt, tour.expiresAt);
  assert.equal(Date.parse(tour.expiresAt) - now.getTime(), 48 * 3_600_000);

  // Three $22 cups: past the $50 refund rule, so the refund that follows waits for the judge.
  const buy = await t.run(shopId, 'buy');
  assert.match(buy.transcript.find((l) => l.did === 'create_cart')!.said, /Cart for 3 × Tea cup/);
  assert.match(buy.transcript.at(-1)!.said, /Paid with the buyer's saved PayPal/);
  assert.equal((await s.orders.get(shopId, buy.cartId!)).order.status, 'paid');

  const refund = await t.run(shopId, 'refund');
  assert.equal((await s.guard.get(refund.recordId!))?.status, 'pending_approval');
  const rules = await t.run(shopId, 'rules');
  assert.equal((await s.guard.get(rules.recordId!))?.status, 'pending_approval');
  await assert.rejects(t.run(shopId, 'commission'), /On your own shop the steps are buy, refund, rules/);

  assert.equal(await t.sweep(new Date(now.getTime() + 49 * 3_600_000)), 1);
  assert.equal(await s.catalogs.byShopId(shopId), undefined, 'gone after two days, with what it made');
  assert.equal(await store.byShop(shopId), undefined);
});

test('the demo shop gets back the stock judges bought, never more than it usually has', async () => {
  const s = await stack();
  const { tours: t } = tours(s);
  const shopId = demoCatalog.shop.id;
  await s.catalogs.modify(shopId, (c) => {
    c.products[0].variants[0].inventory = 0;
    return true;
  });
  await t.restock();
  const restocked = (await s.catalogs.byShopId(shopId))!;
  assert.equal(restocked.products[0].variants[0].inventory, demoCatalog.products[0].variants[0].inventory);
});
