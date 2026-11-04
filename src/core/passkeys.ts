// The owner's passkeys: once a shop has one, every approval is signed by the owner's own device
// (fingerprint, face or PIN), over a challenge made from the exact action being approved. A stolen
// session cookie, a shared phone left unlocked on the chat app, or an agent can't produce that. The
// signature goes into the record's audit trail, so anyone can check later who said OK, to what.

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

/** Kept in the "approved" audit event: enough to re-check the signature with the stored public key. */
export interface ApprovalSignature {
  passkey: string;
  label: string;
  nonce: string;
  client_data: string;
  authenticator_data: string;
  signature: string;
}

type Purpose = 'approve' | 'manage' | 'register';

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

  /** Whether approvals for this shop need a passkey. */
  async required(shopId: string): Promise<boolean> {
    return (await this.deps.store.list(shopId)).length > 0;
  }

  /** Options for making a new passkey. Once a shop has one, adding another needs it too (`manage`). */
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

  /** Keep a new passkey. `proof` is required when the shop already has one. */
  async register(shopId: string, token: string, credential: RegistrationCredential, label: string, proof?: PasskeyProof): Promise<Passkey> {
    if (await this.required(shopId)) {
      if (!proof) throw new HttpError(403, 'Confirm with a passkey you already have before adding another');
      await this.check(shopId, 'manage', 'passkeys', proof);
    }
    const expected = this.expected(shopId, 'register', 'new', token);
    const made = this.webauthn(() => verifyRegistration(credential, expected));
    if (await this.deps.store.get(made.id)) throw new HttpError(409, 'That passkey is already saved');
    const passkey: Passkey = {
      id: made.id,
      shopId,
      publicKey: made.publicKey,
      alg: made.alg,
      counter: made.counter,
      transports: credential.transports?.filter((t) => typeof t === 'string').slice(0, 6),
      label: label.trim().slice(0, 60) || 'My phone',
      backedUp: made.backedUp,
      createdAt: this.now().toISOString(),
    };
    await this.deps.store.put(passkey);
    return passkey;
  }

  /** Remove a passkey; confirmed with one of the shop's passkeys (it can be the same one). */
  async remove(shopId: string, id: string, proof: PasskeyProof): Promise<void> {
    const passkey = await this.deps.store.get(id);
    if (!passkey || passkey.shopId !== shopId) throw notFound('Passkey');
    await this.check(shopId, 'manage', 'passkeys', proof);
    await this.deps.store.remove(id);
  }

  /** Options to sign a decision about `record`, or to change the shop's passkeys. */
  async assertionOptions(shopId: string, purpose: 'approve' | 'manage', record?: GuardRecord): Promise<Challenge> {
    const keys = await this.list(shopId);
    if (!keys.length) throw new HttpError(409, 'This shop has no passkey yet');
    const { token, challenge } = this.issue(shopId, purpose, purpose === 'approve' ? subjectOf(record) : 'passkeys');
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

  /** Check the owner's signature over this exact record. Returns what goes into the audit trail. */
  async signApproval(shopId: string, record: GuardRecord, proof: PasskeyProof): Promise<ApprovalSignature> {
    const passkey = await this.check(shopId, 'approve', subjectOf(record), proof);
    return {
      passkey: passkey.id,
      label: passkey.label,
      nonce: nonceOf(proof.token),
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
    const expected: Expected = { challenge: challengeFor(record.action.ownerId, 'approve', subjectOf(record), signed.nonce), origin: this.deps.origin, rpId: this.rpId };
    try {
      verifyAssertion({ id: signed.passkey, clientDataJSON: signed.client_data, authenticatorData: signed.authenticator_data, signature: signed.signature }, expected, { ...passkey, counter: 0 });
      return { ok: true, label: passkey.label };
    } catch {
      return { ok: false, label: passkey.label };
    }
  }

  private async check(shopId: string, purpose: Purpose, subject: string, proof: PasskeyProof): Promise<Passkey> {
    const passkey = await this.deps.store.get(proof.credential?.id ?? '');
    if (!passkey || passkey.shopId !== shopId) throw new HttpError(403, 'That passkey is not one of this shop\'s');
    const expected = this.expected(shopId, purpose, subject, proof.token);
    const { counter } = this.webauthn(() => verifyAssertion(proof.credential, expected, passkey));
    await this.deps.store.put({ ...passkey, counter, lastUsedAt: this.now().toISOString() });
    return passkey;
  }

  private issue(shopId: string, purpose: Purpose, subject: string): { token: string; challenge: string } {
    const nonce = randomBytes(16).toString('base64url');
    return { token: this.deps.access.signValue(`passkey:${purpose}`, `${shopId}:${nonce}`, TTL_MS, this.now().getTime()), challenge: challengeFor(shopId, purpose, subject, nonce) };
  }

  private expected(shopId: string, purpose: Purpose, subject: string, token: string): Expected {
    const value = this.deps.access.verifyValue(`passkey:${purpose}`, token, this.now().getTime());
    const [forShop, nonce] = value?.split(':') ?? [];
    if (!value || forShop !== shopId || !nonce) throw new HttpError(403, 'That passkey request expired; try again');
    return { challenge: challengeFor(shopId, purpose, subject, nonce), origin: this.deps.origin, rpId: this.rpId };
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

/** The challenge the device signs: it commits to the shop, the purpose and, for approvals, the exact action. */
function challengeFor(shopId: string, purpose: Purpose, subject: string, nonce: string): string {
  return createHash('sha256').update(`sayso:${purpose}:${shopId}:${subject}:${nonce}`).digest('base64url');
}

function subjectOf(record: GuardRecord | undefined): string {
  if (!record) throw new HttpError(400, 'Which request?');
  return `${record.id}:${createHash('sha256').update(canonicalJson(record.action)).digest('hex')}`;
}

function nonceOf(token: string): string {
  return token.split('.')[0].split(':')[1] ?? '';
}

