import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Access, MemoryAccessStore } from '../src/core/access.ts';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { identityFromCode, signInUrl } from '../src/core/paypal/identity.ts';
import { MemorySellerStore, Sellers } from '../src/core/sellers.ts';
import { stack } from './stack.ts';

const RETURN = 'https://sayso.test/api/owner/paypal/callback';
const MAYA = { user_id: 'https://www.paypal.com/webapps/auth/identity/user/maya', payer_id: 'MAYAPAYER123', email: 'maya@example.com', name: 'Maya Ortiz' };
const model: ChatModel = { name: 'fake', json: async () => ({ shop: { name: 'Lumen Candles' }, products: [{ name: 'Soy Candle', variants: [{ title: 'Lavender', price: '18.00', quantity: 5 }] }] }) };

test('the sign-in link asks PayPal for identity, email and payer id, and carries the state', () => {
  const url = new URL(signInUrl({ clientId: 'app-id', webBase: 'https://www.sandbox.paypal.com' } as never, RETURN, 'st4te'));
  assert.equal(url.origin + url.pathname, 'https://www.sandbox.paypal.com/signin/authorize');
  assert.equal(url.searchParams.get('client_id'), 'app-id');
  assert.equal(url.searchParams.get('redirect_uri'), RETURN);
  assert.equal(url.searchParams.get('state'), 'st4te');
  assert.deepEqual(url.searchParams.get('scope')!.split(' '), ['openid', 'email', 'https://uri.paypal.com/services/paypalattributes']);
});

test('a PayPal code becomes a seller once; signing in again is the same seller', async () => {
  const s = await stack(model);
  const sellers = new Sellers({ store: new MemorySellerStore(), catalogs: s.catalogs });
  const identity = await identityFromCode(s.paypal, s.pp.signInCode(MAYA), RETURN);
  assert.deepEqual(identity, { userId: MAYA.user_id, payerId: 'MAYAPAYER123', email: 'maya@example.com', name: 'Maya Ortiz', verified: true });

  const first = await sellers.signIn(identity);
  const again = await sellers.signIn(await identityFromCode(s.paypal, s.pp.signInCode(MAYA), RETURN));
  assert.equal(again.id, first.id);
  assert.equal(again.createdAt, first.createdAt);

  // A code works once, like PayPal's.
  const code = s.pp.signInCode(MAYA);
  await identityFromCode(s.paypal, code, RETURN);
  await assert.rejects(identityFromCode(s.paypal, code, RETURN), /PayPal 400/);
});

test('a new shop has no owner secret when its owner signs in with PayPal, and claiming it makes it theirs alone', async () => {
  const s = await stack(model);
  const sellers = new Sellers({ store: new MemorySellerStore(), catalogs: s.catalogs });
  const { catalog, ownerSecret } = await s.shops.onboard({ text: 'Soy candles, $18' }, 'laptop', { ownerSecret: false });
  assert.equal(ownerSecret, undefined);
  assert.equal(await s.access.hasOwner(catalog.shop.id), false);

  const maya = await sellers.signIn(await identityFromCode(s.paypal, s.pp.signInCode(MAYA), RETURN));
  const other = await sellers.signIn(await identityFromCode(s.paypal, s.pp.signInCode({ user_id: 'someone-else' }), RETURN));
  await sellers.claim(catalog.shop.id, maya.id);
  await sellers.claim(catalog.shop.id, maya.id); // claiming your own shop again is fine
  assert.equal(await sellers.owns(maya.id, catalog.shop.id), true);
  assert.deepEqual((await sellers.shops(maya.id)).map((c) => c.shop.id), [catalog.shop.id]);

  await assert.rejects(sellers.claim(catalog.shop.id, other.id), /belongs to another PayPal account/);
  assert.equal(await sellers.owns(other.id, catalog.shop.id), false);
  assert.deepEqual(await sellers.shops(other.id), []);
});

test("a judge's private tour copy can never be claimed", async () => {
  const s = await stack();
  const sellers = new Sellers({ store: new MemorySellerStore(), catalogs: s.catalogs });
  await s.catalogs.modify('shop_maya', (c) => ((c.shop.visibility = 'private'), true));
  const seller = await sellers.signIn({ userId: 'judge', verified: true });
  await assert.rejects(sellers.claim('shop_maya', seller.id), /belongs to another PayPal account/);
});

test('signed values are bound to their purpose and expire', () => {
  const access = new Access(new MemoryAccessStore(), 'test-session-secret-0123456789');
  const now = 1_000_000;
  const claim = access.signValue('claim', 'shop_abc', 60_000, now);
  assert.equal(access.verifyValue('claim', claim, now + 1), 'shop_abc');
  assert.equal(access.verifyValue('seller', claim, now + 1), undefined, 'a claim is not a seller session');
  assert.equal(access.verifyValue('claim', claim, now + 60_001), undefined, 'expired');
  assert.equal(access.verifyValue('claim', claim.replace('shop_abc', 'shop_xyz'), now + 1), undefined, 'edited');
});
