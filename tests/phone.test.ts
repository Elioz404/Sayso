// The owner's phone: push notifications, shipping labels read from a photo, and products drafted from
// photos that buyers can't see until the owner sets the price.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLabel } from '../src/core/ai/label.ts';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { demoCatalog } from '../src/core/demo-shop.ts';
import type { GuardRecord } from '../src/core/guard/types.ts';
import { links } from '../src/core/links.ts';
import { MemoryPushStore, paidOrderMessage, Push, sayNeededMessage, type PushMessage } from '../src/core/push.ts';
import { stack } from './stack.ts';

const SHOP = demoCatalog.shop.id;
const site = links('https://sayso.test');
const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: 'BPk', auth: 'aa' } });

test('push: only real push services are accepted, and phones that unsubscribed are forgotten', async () => {
  const sent: PushMessage[] = [];
  const push = new Push({
    store: new MemoryPushStore(),
    send: async (sub, message) => {
      sent.push(message);
      return sub.endpoint.includes('gone') ? 'gone' : 'sent';
    },
  });
  await assert.rejects(push.subscribe(SHOP, subscription('http://169.254.169.254/latest'), 'x'), { status: 400 });
  await assert.rejects(push.subscribe(SHOP, subscription('https://evil.example/fcm.googleapis.com/'), 'x'), { status: 400 });
  await push.subscribe(SHOP, subscription('https://fcm.googleapis.com/fcm/send/abc'), 'Android phone');
  await push.subscribe(SHOP, subscription('https://web.push.apple.com/gone-device'), 'iPhone');

  const message = { title: 'Hi', body: 'x', url: '/owner', tag: 't' };
  assert.equal(await push.notify(SHOP, message), 1);
  assert.deepEqual((await push.list(SHOP)).map((s) => s.label), ['Android phone'], 'the gone iPhone is dropped');
  assert.equal(await push.notify('shop_other', message), 0, "one shop's phones never get another's pushes");
});

test('push: a held request says what it is and opens the decision; a paid order opens the orders', () => {
  const record = {
    id: 'say_1',
    createdAt: new Date().toISOString(),
    action: { kind: 'refund.create', actor: { type: 'agent', id: 'agent:x', side: 'merchant' }, ownerId: SHOP, amount: 8200, currency: 'USD', reason: 'Arrived chipped' },
    status: 'pending_approval',
    idempotencyKey: 'k',
    events: [],
  } as unknown as GuardRecord;
  const asked = sayNeededMessage(record, site);
  assert.equal(asked.title, 'Refund $82.00?');
  assert.match(asked.body, /Your agent asked: “Arrived chipped”/);
  assert.equal(asked.url, site.approve('say_1'));

  assert.equal(paidOrderMessage(record, site), undefined);
  const paid = paidOrderMessage({ ...record, action: { ...record.action, kind: 'payment.capture' }, status: 'verified' }, site);
  assert.equal(paid?.title, 'New order: $82.00');
  assert.equal(paid?.url, 'https://sayso.test/owner/orders');
});

test('labels: carrier and tracking number are re-checked, never taken as-is', () => {
  assert.deepEqual(normalizeLabel({ carrier: 'usps', tracking_number: '9400 1000 0000 0000 0000 00', note: null }), { carrier: 'USPS', trackingNumber: '9400100000000000000000', note: undefined });
  assert.equal(normalizeLabel({ carrier: 'Canada Post', tracking_number: '1Z999AA10123456784' }).carrier, 'CANADA_POST');
  assert.equal(normalizeLabel({ carrier: 'Pony Express', tracking_number: '1Z999AA10123456784' }).carrier, 'OTHER');
  const unreadable = normalizeLabel({ carrier: 'UPS', tracking_number: 'call me' });
  assert.equal(unreadable.trackingNumber, undefined);
  assert.match(unreadable.note!, /Couldn't read a tracking number/);
});

const vaseFromPhoto: ChatModel = {
  name: 'fake',
  async json() {
    return { products: [{ name: 'Speckled Mug', description: 'Wheel-thrown, speckled glaze.', category: 'home/kitchen', photo: 1, variants: [{ title: 'Default', price: null, quantity: 3 }] }] };
  },
};

test('photo drafts: buyers never see a draft until the owner sets its price and puts it on sale', async () => {
  const s = await stack(vaseFromPhoto);
  const [draft] = await s.shops.draftFromPhotos(SHOP, ['data:image/jpeg;base64,AAAA']);
  assert.notEqual(draft.id, 'prod_speckled_mug_2', 'ids never collide with what the shop already has');
  const before = await s.call('search_products', { query: 'speckled mug' }, s.buyer);
  assert.ok(!before.text.includes(draft.id), 'not searchable while it is a draft');

  await assert.rejects(s.shops.releaseDraft(SHOP, draft.id, []), { status: 409 }, 'every option needs a price');
  const catalog = await s.shops.releaseDraft(SHOP, draft.id, [{ id: draft.variants[0].id, price: 3_600, inventory: 3 }]);
  assert.equal(catalog.drafts?.length, 0);
  const live = catalog.products.find((p) => p.id === draft.id)!;
  assert.equal(live.variants[0].price, 3_600);
  assert.equal(live.variants[0].priceToConfirm, undefined);
  assert.ok(live.paypalProductId, "registered in PayPal's catalog, like the shop's other products");

  const after = await s.call('search_products', { query: 'speckled mug' }, s.buyer);
  assert.ok(after.text.includes(draft.id), 'on sale now');
});

test('photo drafts can be discarded', async () => {
  const s = await stack(vaseFromPhoto);
  const [draft] = await s.shops.draftFromPhotos(SHOP, ['data:image/jpeg;base64,AAAA']);
  await s.shops.discardDraft(SHOP, draft.id);
  assert.equal((await s.shops.get(SHOP)).drafts?.length, 0);
});
