// Approving with a passkey: once a shop has one, an OK is a signature from the owner's device over
// the exact action, kept in the audit trail. A software authenticator stands in for the phone.

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { test } from 'node:test';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { defaultMerchantPolicy } from '../src/core/guard/policy.ts';
import type { Challenge } from '../src/core/passkeys.ts';
import { decodeCbor } from '../src/core/webauthn.ts';
import { stack } from './stack.ts';

const SHOP = demoCatalog.shop.id;
const OWNER = `owner:${SHOP}`;
const agent = { type: 'agent' as const, id: 'agent:helper:key_1', side: 'merchant' as const };

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
  await s.passkeys.register(SHOP, options.token, device.create(options), "Maya's phone");
  /** A request only the owner can approve (an agent changing the rules). */
  const held = () => s.saySo.submitPolicy(defaultMerchantPolicy(SHOP, 'USD'), 'Same rules, please', agent);
  return { s, device, held };
}

test('the decoder reads what the test authenticator writes', () => {
  assert.deepEqual(decodeCbor(cbor(new Map<unknown, unknown>([['a', 1], [-2, -300]])))[0], new Map<unknown, unknown>([['a', 1], [-2, -300]]));
});

test('once a shop has a passkey, an OK is a signature over the exact request, kept in the audit trail', async () => {
  const { s, device, held } = await withPasskey();
  const record = await held();
  await assert.rejects(s.saySo.decide(SHOP, record.id, 'approve', OWNER), { status: 428 });

  const proof = device.get(await s.passkeys.assertionOptions(SHOP, 'approve', record));
  const approved = await s.saySo.decide(SHOP, record.id, 'approve', OWNER, 'Fine', proof);
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

test('a signature for one request cannot approve another, and foreign or forged passkeys are refused', async () => {
  const { s, device, held } = await withPasskey();
  const [a, b] = [await held(), await held()];
  const forA = device.get(await s.passkeys.assertionOptions(SHOP, 'approve', a));
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, undefined, forA), { status: 403 });

  const options = await s.passkeys.assertionOptions(SHOP, 'approve', b);
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, undefined, phone().get(options)), { status: 403 });
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, undefined, phone('https://sayso-login.example').get(options)), { status: 403 });

  // Right passkey id, wrong key: a forged signature.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await assert.rejects(s.saySo.decide(SHOP, b.id, 'approve', OWNER, undefined, device.get(options, privateKey)), /signature does not check out/);
  assert.equal((await s.guard.get(b.id))?.status, 'pending_approval');
});

test('saying no never needs the passkey; a device that skipped the fingerprint cannot make one', async () => {
  const s = await stack();
  const lazy = phone('https://sayso.test', { verified: false });
  const options = await s.passkeys.registrationOptions(SHOP, 'Maya Ceramics');
  await assert.rejects(s.passkeys.register(SHOP, options.token, lazy.create(options), 'Old phone'), /fingerprint, face or PIN/);

  const { s: s2, held } = await withPasskey();
  const record = await held();
  assert.equal((await s2.saySo.decide(SHOP, record.id, 'reject', OWNER, 'No')).status, 'rejected');
});

test('adding or removing passkeys needs one the shop already has', async () => {
  const { s, device } = await withPasskey();
  const second = phone();
  const options = await s.passkeys.registrationOptions(SHOP, 'Maya Ceramics');
  await assert.rejects(s.passkeys.register(SHOP, options.token, second.create(options), 'Laptop'), { status: 403 });

  const confirm = device.get(await s.passkeys.assertionOptions(SHOP, 'manage'));
  const laptop = await s.passkeys.register(SHOP, options.token, second.create(options), 'Laptop', confirm);
  assert.equal((await s.passkeys.list(SHOP)).length, 2);

  await s.passkeys.remove(SHOP, laptop.id, device.get(await s.passkeys.assertionOptions(SHOP, 'manage')));
  assert.deepEqual((await s.passkeys.list(SHOP)).map((k) => k.label), ["Maya's phone"]);
});
