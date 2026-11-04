// Just enough WebAuthn to check passkeys with node:crypto alone: read what the authenticator returns
// when a passkey is made (CBOR attestation object, COSE public key) and verify its signatures later.
// Attestation statements are not checked (Sayso asks for "none"): what matters is that the same
// device, unlocked by its owner, signs every approval.

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export interface RegistrationCredential {
  id: string;
  /** base64url */
  clientDataJSON: string;
  /** base64url */
  attestationObject: string;
  transports?: string[];
}

export interface AssertionCredential {
  id: string;
  /** base64url */
  clientDataJSON: string;
  /** base64url */
  authenticatorData: string;
  /** base64url */
  signature: string;
}

export interface Expected {
  /** base64url of the challenge Sayso issued. */
  challenge: string;
  origin: string;
  rpId: string;
}

export interface NewCredential {
  id: string;
  /** SPKI DER, base64url. */
  publicKey: string;
  alg: number;
  counter: number;
  backedUp: boolean;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

/** COSE algorithms Sayso accepts: ES256, EdDSA, RS256. */
export const ALGORITHMS = [-7, -8, -257] as const;

export class WebAuthnError extends Error {}

/** Check a freshly made passkey and return what to keep of it. */
export function verifyRegistration(credential: RegistrationCredential, expected: Expected): NewCredential {
  checkClientData(credential.clientDataJSON, 'webauthn.create', expected);
  const attestation = decodeCbor(fromB64url(credential.attestationObject))[0];
  const authData = attestation instanceof Map ? attestation.get('authData') : undefined;
  if (!(authData instanceof Uint8Array)) throw new WebAuthnError('The passkey response has no authenticator data');
  const auth = parseAuthData(Buffer.from(authData), expected.rpId);
  if (!(auth.flags & FLAG_AT) || !auth.credentialId || !auth.cose) throw new WebAuthnError('The passkey response has no credential');
  if (toB64url(auth.credentialId) !== credential.id) throw new WebAuthnError('The passkey id does not match');
  const { key, alg } = coseToKey(auth.cose);
  return { id: credential.id, publicKey: toB64url(key.export({ type: 'spki', format: 'der' })), alg, counter: auth.counter, backedUp: Boolean(auth.flags & FLAG_BS) };
}

/** Check a passkey signature over the challenge. Returns the authenticator's new counter. */
export function verifyAssertion(credential: AssertionCredential, expected: Expected, key: { publicKey: string; alg: number; counter: number }): { counter: number } {
  const clientData = fromB64url(credential.clientDataJSON);
  checkClientData(credential.clientDataJSON, 'webauthn.get', expected);
  const authData = fromB64url(credential.authenticatorData);
  const auth = parseAuthData(authData, expected.rpId);
  const signed = Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
  if (!checkSignature(key, signed, fromB64url(credential.signature))) throw new WebAuthnError('The passkey signature does not check out');
  // A counter that goes backwards means a cloned authenticator. Synced passkeys always report 0.
  if ((auth.counter !== 0 || key.counter !== 0) && auth.counter <= key.counter) throw new WebAuthnError('This passkey was used out of order');
  return { counter: auth.counter };
}

function checkSignature(key: { publicKey: string; alg: number }, data: Buffer, signature: Buffer): boolean {
  const publicKey = createPublicKey({ key: fromB64url(key.publicKey), format: 'der', type: 'spki' });
  if (key.alg === -8) return verify(null, data, publicKey, signature);
  if (key.alg === -7) return verify('sha256', data, { key: publicKey, dsaEncoding: 'der' }, signature);
  if (key.alg === -257) return verify('sha256', data, publicKey, signature);
  return false;
}

function checkClientData(b64: string, type: string, expected: Expected): void {
  let data: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
  try {
    data = JSON.parse(fromB64url(b64).toString('utf8'));
  } catch {
    throw new WebAuthnError('The passkey response is not readable');
  }
  if (data.type !== type) throw new WebAuthnError('Wrong kind of passkey response');
  if (data.challenge !== expected.challenge) throw new WebAuthnError('The passkey answered a different request');
  if (data.origin !== expected.origin) throw new WebAuthnError(`The passkey was used on ${data.origin ?? 'another site'}`);
  if (data.crossOrigin) throw new WebAuthnError('The passkey was used from inside another site');
}

interface AuthData {
  flags: number;
  counter: number;
  credentialId?: Buffer;
  cose?: Map<unknown, unknown>;
}

function parseAuthData(data: Buffer, rpId: string): AuthData {
  if (data.length < 37) throw new WebAuthnError('Authenticator data is too short');
  if (!data.subarray(0, 32).equals(createHash('sha256').update(rpId).digest())) throw new WebAuthnError('The passkey belongs to another site');
  const flags = data[32];
  if (!(flags & FLAG_UP)) throw new WebAuthnError('The owner was not present');
  if (!(flags & FLAG_UV)) throw new WebAuthnError('The device did not check it was the owner (fingerprint, face or PIN)');
  const counter = data.readUInt32BE(33);
  if (!(flags & FLAG_AT)) return { flags, counter };
  const idLength = data.readUInt16BE(53);
  const credentialId = data.subarray(55, 55 + idLength);
  const [cose] = decodeCbor(data.subarray(55 + idLength));
  if (!(cose instanceof Map)) throw new WebAuthnError('The passkey public key is not readable');
  return { flags, counter, credentialId, cose };
}

function coseToKey(cose: Map<unknown, unknown>): { key: KeyObject; alg: number } {
  const alg = cose.get(3);
  const b64 = (label: number) => {
    const v = cose.get(label);
    if (!(v instanceof Uint8Array)) throw new WebAuthnError('The passkey public key is incomplete');
    return toB64url(v);
  };
  if (alg === -7 && cose.get(1) === 2 && cose.get(-1) === 1) return { alg, key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(-2), y: b64(-3) }, format: 'jwk' }) };
  if (alg === -8 && cose.get(1) === 1 && cose.get(-1) === 6) return { alg, key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64(-2) }, format: 'jwk' }) };
  if (alg === -257 && cose.get(1) === 3) return { alg, key: createPublicKey({ key: { kty: 'RSA', n: b64(-1), e: b64(-2) }, format: 'jwk' }) };
  throw new WebAuthnError('This kind of passkey is not supported');
}

/** One CBOR item from `data`, and the offset after it. Covers what authenticators send. */
export function decodeCbor(data: Uint8Array, start = 0): [unknown, number] {
  const view = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  let at = start;
  const item = (): unknown => {
    if (at >= view.length) throw new WebAuthnError('CBOR ends early');
    const head = view[at++];
    const major = head >> 5;
    const info = head & 31;
    const length = (): number => {
      if (info < 24) return info;
      const size = { 24: 1, 25: 2, 26: 4, 27: 8 }[info];
      if (!size || at + size > view.length) throw new WebAuthnError('CBOR length is not supported');
      const n = size === 8 ? Number(view.readBigUInt64BE(at)) : view.readUIntBE(at, size);
      at += size;
      return n;
    };
    if (major === 7) {
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22 || info === 23) return null;
      throw new WebAuthnError('CBOR value is not supported');
    }
    const n = length();
    switch (major) {
      case 0:
        return n;
      case 1:
        return -1 - n;
      case 2: {
        if (at + n > view.length) throw new WebAuthnError('CBOR ends early');
        const bytes = new Uint8Array(view.subarray(at, at + n));
        at += n;
        return bytes;
      }
      case 3: {
        if (at + n > view.length) throw new WebAuthnError('CBOR ends early');
        const text = view.subarray(at, at + n).toString('utf8');
        at += n;
        return text;
      }
      case 4:
        return Array.from({ length: n }, () => item());
      case 5: {
        const map = new Map<unknown, unknown>();
        for (let i = 0; i < n; i++) {
          const key = item();
          map.set(key, item());
        }
        return map;
      }
      default:
        throw new WebAuthnError('CBOR value is not supported');
    }
  };
  const value = item();
  return [value, at];
}

export function toB64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
