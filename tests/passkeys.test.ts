// Approving with a passkey: once a shop has one, an OK is a signature from the owner's device over
// the exact action, kept in the audit trail. Every challenge works once and only for what it was made
// for. A software authenticator stands in for the phone.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { test } from 'node:test';
import { ownerActor } from '../src/core/actors.ts';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { defaultMerchantPolicy } from '../src/core/guard/policy.ts';
import type { Challenge } from '../src/core/passkeys.ts';
import { decodeCbor } from '../src/core/webauthn.ts';
import { stack } from './stack.ts';

const SHOP = demoCatalog.shop.id;
const OWNER = `owner:${SHOP}`;
const agent = { type: 'agent' as const, id: 'agent:helper:key_1', side: 'merchant' as const };
const fresh = { freshSignIn: true };

/** CBOR, just the shapes an authenticator sends. */
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) =>
    n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('unsupported');
}

/** A phone with one passkey for `origin`. `verified: false` is a device that skipped the fingerprint. */
function phone(origin = 'https://sayso.test', options: { verified?: boolean } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const id = randomBytes(16);
  const jwk = publicKey.export({ format: 'jwk' });
  const rpHash = createHash('sha256').update(new URL(origin).hostname).digest();
  const flags = options.verified === false ? 0x01 : 0x05;
  const clientData = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin }));
  let counter = 0;

  return {
    create(c: Challenge) {
      const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
      const authData = Buffer.concat([rpHash, Buffer.from([flags | 0x40]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, id.length]), id, cose]);
      const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: id.toString('base64url'), clientDataJSON: clientData('webauthn.create', c.options.challenge as string).toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] };
    },
    get(c: Challenge, key: KeyObject = privateKey) {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(++counter);
      const authData = Buffer.concat([rpHash, Buffer.from([flags]), count]);
      const data = clientData('webauthn.get', c.options.challenge as string);
      const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(data).digest()]), key);
      return { token: c.token, credential: { id: id.toString('base64url'), clientDataJSON: data.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') } };
    },
  };
}

async function withPasskey() {
  const s = await stack();
  const device = phone();
  const options = await s.passkeys.registrationOptions(SHOP, 'Maya Ceramics');
  const saved = await s.passkeys.register(SHOP, options.token, device.create(options), "Maya's phone", fresh);
  /** A request only the owner can approve (an agent changing the rules). */
  const held = () => s.saySo.submitPolicy(defaultMerchantPolicy(SHOP, 'USD'), 'Same rules, please', agent);
  return { s, device, saved, held };
}

test('the decoder reads what the test authenticator writes', () => {
  assert.deepEqual(decodeCbor(cbor(new Map<unknown, unknown>([['a', 1], [-2, -300]])))[0], new Map<unknown, unknown>([['a', 1], [-2, -300]]));
});

test('once a shop has a passkey, an OK is a signature over the exact request, kept in the audit trail', async () => {
  const { s, device, held } = await withPasskey();
  const record = await held();
  await assert.rejects(s.saySo.decide(SHOP, record.id, 'approve', OWNER), { status: 428 });

  const proof = device.get(await s.passkeys.approvalOptions(SHOP, record));
  const approved = await s.saySo.decide(SHOP, record.id, 'approve', OWNER, { note: 'Fine', proof });
  assert.equal(approved.status, 'verified');
  const event = approved.events.find((e) => e.type === 'approved')!;
  assert.equal((event.data?.passkey as { label: string }).label, "Maya's phone");
  assert.equal(event.data?.note, 'Fine');
  assert.deepEqual(await s.passkeys.checkApproval(approved), { ok: true, label: "Maya's phone" });

  // Change what was approved after the fact and the signature no longer matches it.
  const edited = structuredClone(approved);
  edited.action.reason = 'Something else';
  assert.equal((await s.passkeys.checkApproval(edited))?.ok, false);
});

test('a signature for one request cannot approve another, and foreign, forged or replayed answers are refused', async () => {
  const { s, device, held } = await withPasskey();
  const [a, b] = [await held(), await held()];
  const forA = device.get(await s.passkeys.approvalOptions(SHOP, a));
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, { proof: forA }), { status: 403 });

  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, { proof: phone().get(await s.passkeys.approvalOptions(SHOP, b)) }), { status: 403 });
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, { proof: phone('https://sayso-login.example').get(await s.passkeys.approvalOptions(SHOP, b)) }), { status: 403 });

  // Right passkey id, wrong key: a forged signature.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, { proof: device.get(await s.passkeys.approvalOptions(SHOP, b), privateKey) }), /signature does not check out/);
  assert.equal((await s.guard.get(b.id))?.status, 'pending_approval');

  // Each challenge works once: a captured answer can't be played again.
  const once = await s.passkeys.confirmationOptions(SHOP, 'phone-link');
  const answer = device.get(once);
  await s.passkeys.confirm(SHOP, 'phone-link', answer);
  await assert.rejects(s.passkeys.confirm(SHOP, 'phone-link', answer), /already used/);
});

test('saying no never needs the passkey; a device that skipped the fingerprint cannot make one', async () => {
  const s = await stack();
  const lazy = phone('https://sayso.test', { verified: false });
  const options = await s.passkeys.registrationOptions(SHOP, 'Maya Ceramics');
  await assert.rejects(s.passkeys.register(SHOP, options.token, lazy.create(options), 'Old phone', fresh), /fingerprint, face or PIN/);

  const { s: s2, held } = await withPasskey();
  const record = await held();
  assert.equal((await s2.saySo.decide(SHOP, record.id, 'reject', OWNER, { note: 'No' })).status, 'rejected');
});

test('the first passkey needs a fresh sign-in; later changes need that or a confirmation of that exact change', async () => {
  const s = await stack();
  const options = await s.passkeys.registrationOptions(SHOP, 'Maya Ceramics');
  await assert.rejects(s.passkeys.register(SHOP, options.token, phone().create(options), 'Thief', { freshSignIn: false }), /sign in again/);

  const { s: s2, device, saved } = await withPasskey();
  const second = phone();
  const next = await s2.passkeys.registrationOptions(SHOP, 'Maya Ceramics');
  await assert.rejects(s2.passkeys.register(SHOP, next.token, second.create(next), 'Laptop', { freshSignIn: false }), { status: 428 });

  // A confirmation made to remove one passkey can't be used to add another (or remove a different one).
  const toRemove = device.get(await s2.passkeys.confirmationOptions(SHOP, `remove-passkey:${saved.id}`));
  await assert.rejects(s2.passkeys.register(SHOP, next.token, second.create(next), 'Laptop', { freshSignIn: false, proof: toRemove }), { status: 403 });

  const laptop = await s2.passkeys.register(SHOP, next.token, second.create(next), 'Laptop', { freshSignIn: false, proof: device.get(await s2.passkeys.confirmationOptions(SHOP, 'add-passkey')) });
  assert.equal((await s2.passkeys.list(SHOP)).length, 2);

  await assert.rejects(s2.passkeys.remove(SHOP, laptop.id, { freshSignIn: false, proof: device.get(await s2.passkeys.confirmationOptions(SHOP, `remove-passkey:${saved.id}`)) }), { status: 403 });
  await s2.passkeys.remove(SHOP, laptop.id, { freshSignIn: false, proof: device.get(await s2.passkeys.confirmationOptions(SHOP, `remove-passkey:${laptop.id}`)) });
  assert.deepEqual((await s2.passkeys.list(SHOP)).map((k) => k.label), ["Maya's phone"]);
});

test('with a passkey, adopting an earned rule is confirmed with it too', async () => {
  const { s, device } = await withPasskey();
  // Three refunds the owner approved after the $50 rule held them: enough to earn a suggestion.
  for (const [i, amount] of [5_500, 6_000, 6_200].entries()) {
    const at = new Date(Date.now() - (i + 1) * 3_600_000).toISOString();
    await s.guardStore.insert({
      id: `say_earned${i}`,
      createdAt: at,
      action: { kind: 'refund.create', actor: agent, ownerId: SHOP, amount, currency: 'USD', reason: 'Chipped' },
      decision: { verdict: 'require_approval', hits: [{ ruleId: 'refund-cap', verdict: 'require_approval', message: 'over' }] },
      status: 'verified',
      idempotencyKey: `earned${i}`,
      events: [{ at, type: 'approved', by: OWNER, hash: 'h' }],
    });
  }
  const [suggestion] = (await s.saySo.autonomy(SHOP)).suggestions;
  await assert.rejects(s.saySo.adoptSuggestion(SHOP, suggestion.id, ownerActor(SHOP)), { status: 428 });
  const wrong = device.get(await s.passkeys.confirmationOptions(SHOP, 'adopt-rule:something-else'));
  await assert.rejects(s.saySo.adoptSuggestion(SHOP, suggestion.id, ownerActor(SHOP), wrong), { status: 403 });

  const proof = device.get(await s.passkeys.confirmationOptions(SHOP, `adopt-rule:${suggestion.id}`));
  assert.equal((await s.saySo.adoptSuggestion(SHOP, suggestion.id, ownerActor(SHOP), proof)).status, 'verified');
});

test('the shared demo session decides refunds but cannot approve a change to the demo rules', async () => {
  const s = await stack();
  const record = await s.saySo.submitPolicy(defaultMerchantPolicy(SHOP, 'USD'), 'Loosen up', agent);
  await assert.rejects(s.saySo.decide(SHOP, record.id, 'approve', OWNER, { shared: true }), { status: 403 });
  assert.equal((await s.saySo.decide(SHOP, record.id, 'reject', OWNER, { shared: true })).status, 'rejected');
});
