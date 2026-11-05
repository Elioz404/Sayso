// The owner's passkeys: once a shop has one, every approval is signed by the owner's own device
// (fingerprint, face or PIN), over a challenge made from the exact action being approved. A stolen
// session cookie, a shared phone left unlocked on the chat app, or an agent can't produce that. The
// signature goes into the record's audit trail, so anyone can check later who said OK, to what.
//
// Every challenge is single-use and bound to one operation: an approval of one record, or a
// confirmation of one change ("remove passkey X", "adopt rule Y"). Managing passkeys needs either a
// passkey the shop already has or a fresh sign-in, so a session cookie stolen days ago can't add one.

import { createHash, randomBytes } from 'node:crypto';
import type { Access } from './access.ts';
import { HttpError, notFound } from './errors.ts';
import { canonicalJson } from './guard/engine.ts';
import type { GuardRecord } from './guard/types.ts';
import { ALGORITHMS, toB64url, verifyAssertion, verifyRegistration, WebAuthnError, type AssertionCredential, type Expected, type RegistrationCredential } from './webauthn.ts';

export interface Passkey {
  /** The credential id, base64url. */
  id: string;
  shopId: string;
  /** SPKI DER, base64url. */
  publicKey: string;
  alg: number;
  counter: number;
  transports?: string[];
  /** What the owner calls the device: "Maya's iPhone". */
  label: string;
  /** Synced by the platform (iCloud Keychain, Google Password Manager) rather than tied to one device. */
  backedUp: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface PasskeyStore {
  list(shopId: string): Promise<Passkey[]>;
  get(id: string): Promise<Passkey | undefined>;
  put(passkey: Passkey): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryPasskeyStore implements PasskeyStore {
  private readonly keys = new Map<string, Passkey>();
  async list(shopId: string) {
    return [...this.keys.values()].filter((k) => k.shopId === shopId).map((k) => structuredClone(k));
  }
  async get(id: string) {
    const k = this.keys.get(id);
    return k && structuredClone(k);
  }
  async put(passkey: Passkey) {
    this.keys.set(passkey.id, structuredClone(passkey));
  }
  async remove(id: string) {
    this.keys.delete(id);
  }
}

export interface PasskeysDeps {
  store: PasskeyStore;
  access: Access;
  /** The site's origin, e.g. https://sayso-ovph.onrender.com. The passkey's site (rp id) is its host. */
  origin: string;
  now?: () => Date;
}

/** What a page needs to ask the device for a passkey, plus the signed token to send back with the answer. */
export interface Challenge {
  token: string;
  options: Record<string, unknown>;
}

/** A passkey answer to a challenge Sayso issued. */
export interface PasskeyProof {
  token: string;
  credential: AssertionCredential;
}

/** How the owner shows it's really them before changing passkeys: a fresh sign-in, or a passkey they have. */
export interface OwnerCheck {
  freshSignIn: boolean;
  proof?: PasskeyProof;
}

/** Kept in the "approved" audit event: enough to re-check the signature with the stored public key. */
export interface ApprovalSignature {
  passkey: string;
  label: string;
  nonce: string;
  origin: string;
  client_data: string;
  authenticator_data: string;
  signature: string;
}

/** What a confirmation is for. Each one is signed over its own subject, so it can't be reused for another. */
export type Confirmation = 'add-passkey' | `remove-passkey:${string}` | `adopt-rule:${string}` | `rules:${string}` | 'phone-link' | 'agent-key';

type Purpose = 'approve' | 'confirm' | 'register';

/** A passkey's answer as the browser sends it, bounded (base64url fields). */
export const PROOF_SCHEMA = {
  type: 'object',
  properties: {
    token: { type: 'string', maxLength: 300 },
    credential: {
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: 1400 },
        clientDataJSON: { type: 'string', maxLength: 4000 },
        authenticatorData: { type: 'string', maxLength: 4000 },
        signature: { type: 'string', maxLength: 2000 },
      },
      required: ['id', 'clientDataJSON', 'authenticatorData', 'signature'],
    },
  },
  required: ['token', 'credential'],
} as const;

/** A newly made passkey as the browser sends it. */
export const REGISTRATION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 1400 },
    clientDataJSON: { type: 'string', maxLength: 4000 },
    attestationObject: { type: 'string', maxLength: 20_000 },
    transports: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 20 } },
  },
  required: ['id', 'clientDataJSON', 'attestationObject'],
} as const;

const TTL_MS = 5 * 60_000;
const MAX_PASSKEYS = 10;

export class Passkeys {
  private readonly deps: PasskeysDeps;
  readonly rpId: string;

  constructor(deps: PasskeysDeps) {
    this.deps = deps;
    this.rpId = new URL(deps.origin).hostname;
  }

  async list(shopId: string): Promise<Passkey[]> {
    return (await this.deps.store.list(shopId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Whether approvals (and rule changes) for this shop need a passkey. */
  async required(shopId: string): Promise<boolean> {
    return (await this.deps.store.list(shopId)).length > 0;
  }

  /** Options for making a new passkey on this device. */
  async registrationOptions(shopId: string, shopName: string): Promise<Challenge> {
    const existing = await this.list(shopId);
    if (existing.length >= MAX_PASSKEYS) throw new HttpError(409, `Up to ${MAX_PASSKEYS} passkeys per shop`);
    const { token, challenge } = this.issue(shopId, 'register', 'new');
    return {
      token,
      options: {
        challenge,
        rp: { id: this.rpId, name: 'Sayso' },
        user: { id: toB64url(Buffer.from(shopId)), name: shopName, displayName: `${shopName} (Sayso)` },
        pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: 'public-key', alg })),
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        attestation: 'none',
        excludeCredentials: existing.map((k) => ({ type: 'public-key', id: k.id, transports: k.transports })),
        timeout: 120_000,
      },
    };
  }

  /**
   * Keep a new passkey. The first one needs a fresh sign-in (so an old stolen session can't lock the
   * owner out with its own passkey); later ones need that or one of the shop's passkeys.
   */
  async register(shopId: string, token: unknown, credential: RegistrationCredential, label: string, check: OwnerCheck): Promise<Passkey> {
    const existing = await this.list(shopId);
    if (existing.length >= MAX_PASSKEYS) throw new HttpError(409, `Up to ${MAX_PASSKEYS} passkeys per shop`);
    if (!existing.length && !check.freshSignIn) throw new HttpError(403, 'For your safety, sign in again (in the last 30 minutes) to add the first passkey');
    if (existing.length) await this.authorize(shopId, 'add-passkey', check);
    const { expected } = await this.expected(shopId, 'register', 'new', token);
    const made = this.webauthn(() => verifyRegistration(credential, expected));
    if (await this.deps.store.get(made.id)) throw new HttpError(409, 'That passkey is already saved');
    const passkey: Passkey = {
      id: made.id,
      shopId,
      publicKey: made.publicKey,
      alg: made.alg,
      counter: made.counter,
      transports: Array.isArray(credential.transports) ? credential.transports.filter((t): t is string => typeof t === 'string').slice(0, 6) : undefined,
      label: label.trim().slice(0, 60) || 'My phone',
      backedUp: made.backedUp,
      createdAt: this.now().toISOString(),
    };
    await this.deps.store.put(passkey);
    return passkey;
  }

  /** Remove a passkey, confirmed with a fresh sign-in or with one of the shop's passkeys (it can be the same one). */
  async remove(shopId: string, id: string, check: OwnerCheck): Promise<void> {
    const passkey = await this.deps.store.get(id);
    if (!passkey || passkey.shopId !== shopId) throw notFound('Passkey');
    await this.authorize(shopId, `remove-passkey:${id}`, check);
    await this.deps.store.remove(id);
  }

  /** Options to sign a decision about `record`. */
  approvalOptions(shopId: string, record: GuardRecord): Promise<Challenge> {
    return this.assertionOptions(shopId, 'approve', subjectOf(record));
  }

  /** Options to confirm one change with a passkey. */
  confirmationOptions(shopId: string, what: Confirmation): Promise<Challenge> {
    return this.assertionOptions(shopId, 'confirm', what);
  }

  /** Check a passkey confirmation of `what`. Each challenge works once. */
  async confirm(shopId: string, what: Confirmation, proof: PasskeyProof | undefined): Promise<void> {
    if (!proof) throw new HttpError(428, 'Confirm with your passkey (fingerprint, face or PIN)');
    await this.check(shopId, 'confirm', what, proof);
  }

  /** Check the owner's signature over this exact record. Returns what goes into the audit trail. */
  async signApproval(shopId: string, record: GuardRecord, proof: PasskeyProof): Promise<ApprovalSignature> {
    const { passkey, nonce } = await this.check(shopId, 'approve', subjectOf(record), proof);
    return {
      passkey: passkey.id,
      label: passkey.label,
      nonce,
      origin: this.deps.origin,
      client_data: proof.credential.clientDataJSON,
      authenticator_data: proof.credential.authenticatorData,
      signature: proof.credential.signature,
    };
  }

  /**
   * Re-check an approval signature from the audit trail, against the passkey's public key. True only if
   * that passkey signed this record's action as it is stored now.
   */
  async checkApproval(record: GuardRecord): Promise<{ ok: boolean; label?: string } | undefined> {
    const signed = record.events.find((e) => e.type === 'approved')?.data?.passkey as ApprovalSignature | undefined;
    if (!signed) return undefined;
    const passkey = await this.deps.store.get(signed.passkey);
    if (!passkey) return { ok: false, label: signed.label };
    const origin = signed.origin ?? this.deps.origin;
    const expected: Expected = { challenge: challengeFor(record.action.ownerId, 'approve', subjectOf(record), signed.nonce), origin, rpId: new URL(origin).hostname };
    try {
      const credential = { id: signed.passkey, clientDataJSON: signed.client_data, authenticatorData: signed.authenticator_data, signature: signed.signature };
      verifyAssertion(credential, expected, passkey, { checkCounter: false });
      return { ok: true, label: passkey.label };
    } catch {
      return { ok: false, label: passkey.label };
    }
  }

  /** A fresh sign-in, or (once the shop has passkeys) a passkey confirmation of `what`. */
  private async authorize(shopId: string, what: Confirmation, check: OwnerCheck): Promise<void> {
    if (check.freshSignIn && !check.proof) return;
    await this.confirm(shopId, what, check.proof);
  }

  private async assertionOptions(shopId: string, purpose: 'approve' | 'confirm', subject: string): Promise<Challenge> {
    const keys = await this.list(shopId);
    if (!keys.length) throw new HttpError(409, 'This shop has no passkey yet');
    const { token, challenge } = this.issue(shopId, purpose, subject);
    return {
      token,
      options: {
        challenge,
        rpId: this.rpId,
        allowCredentials: keys.map((k) => ({ type: 'public-key', id: k.id, transports: k.transports })),
        userVerification: 'required',
        timeout: 120_000,
      },
    };
  }

  private async check(shopId: string, purpose: Purpose, subject: string, proof: PasskeyProof): Promise<{ passkey: Passkey; nonce: string }> {
    const passkey = await this.deps.store.get(typeof proof?.credential?.id === 'string' ? proof.credential.id : '');
    if (!passkey || passkey.shopId !== shopId) throw new HttpError(403, "That passkey is not one of this shop's");
    const { expected, nonce } = await this.expected(shopId, purpose, subject, proof.token);
    const { counter } = this.webauthn(() => verifyAssertion(proof.credential, expected, passkey));
    await this.deps.store.put({ ...passkey, counter, lastUsedAt: this.now().toISOString() });
    return { passkey, nonce };
  }

  private issue(shopId: string, purpose: Purpose, subject: string): { token: string; challenge: string } {
    const nonce = randomBytes(16).toString('base64url');
    return { token: this.deps.access.signValue(`passkey:${purpose}`, `${shopId}:${nonce}`, TTL_MS, this.now().getTime()), challenge: challengeFor(shopId, purpose, subject, nonce) };
  }

  /** What the device must have signed for this token, and the token's nonce, which is spent here. */
  private async expected(shopId: string, purpose: Purpose, subject: string, token: unknown): Promise<{ expected: Expected; nonce: string }> {
    const now = this.now().getTime();
    const [forShop, nonce] = this.deps.access.verifyValue(`passkey:${purpose}`, token, now)?.split(':') ?? [];
    if (forShop !== shopId || !nonce) throw new HttpError(403, 'That passkey request expired; try again');
    if (!(await this.deps.access.consumeOnce(`passkey:${nonce}`, new Date(now + TTL_MS)))) throw new HttpError(403, 'That passkey request was already used; try again');
    return { expected: { challenge: challengeFor(shopId, purpose, subject, nonce), origin: this.deps.origin, rpId: this.rpId }, nonce };
  }

  private webauthn<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof WebAuthnError) throw new HttpError(403, err.message);
      throw new HttpError(400, 'That passkey response is not readable');
    }
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

/** The challenge the device signs: it commits to the shop, the purpose and what exactly is being confirmed. */
function challengeFor(shopId: string, purpose: Purpose, subject: string, nonce: string): string {
  return createHash('sha256').update(`sayso:${purpose}:${shopId}:${subject}:${nonce}`).digest('base64url');
}

/** An approval commits to the record and a hash of its action, so a signature can't be moved to another. */
function subjectOf(record: GuardRecord): string {
  return `${record.id}:${createHash('sha256').update(canonicalJson(record.action)).digest('hex')}`;
}
