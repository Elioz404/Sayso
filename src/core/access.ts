// Who may do what. Two kinds of credentials, deliberately separate:
//   - agent keys (sk_agent_...): what the owner's own AI agent holds. They can run the shop through the
//     tools, but money-moving actions go through Guard, and they can never approve a Guard record.
//   - the owner's signed session, opened by signing in with PayPal (or, where PayPal sign-in isn't set
//     up, the owner secret sk_owner_...): the only way to approve, reject, publish a shop or change its policy.
// Secrets are stored as sha256 hashes and shown exactly once.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.ts';

/** "Last used" is shown to the owner; writing it on every call would turn each request into a write. */
const LAST_USED_RESOLUTION_MS = 10 * 60_000;
/** How long a sign-in lasts on a device. */
export const SESSION_TTL_MS = 7 * 86_400_000;
/** A session this young counts as a fresh sign-in: enough to tie a new device or a first passkey to the shop. */
export const FRESH_SESSION_MS = 15 * 60_000;
/** How long a "continue on your phone" link works. It also works only once. */
export const HANDOFF_TTL_MS = 5 * 60_000;
const HANDOFF = 'owner-handoff';

export interface AgentKey {
  id: string;
  shopId: string;
  label: string;
  hash: string;
  /** Last 4 characters, so the owner can tell keys apart. */
  hint: string;
  createdAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  /** A key everyone trying the hosted demo holds: it can't be revoked, and it sees buyers' details masked. */
  shared?: boolean;
}

export interface OwnerSession {
  shopId: string;
  /** owner: the shop's owner (owner secret, PayPal or a judge's tour). demo: the shared public demo session. */
  kind: 'owner' | 'demo';
  /** When this device signed in, and when the sign-in ends (ms). */
  issuedAt: number;
  expiresAt: number;
  /**
   * signin: a credential was just shown (owner secret, PayPal, starting a tour). switch: another shop of
   * a seller already signed in with PayPal. handoff: opened from another signed-in device's QR code.
   */
  via: 'signin' | 'switch' | 'handoff';
}

export interface AccessStore {
  setOwnerHash(shopId: string, hash: string): Promise<void>;
  ownerHash(shopId: string): Promise<string | undefined>;
  putKey(key: AgentKey): Promise<void>;
  keyByHash(hash: string): Promise<AgentKey | undefined>;
  listKeys(shopId: string): Promise<AgentKey[]>;
  /** The shop's session generation; sessions signed under an older one are no longer valid. */
  sessionEpoch(shopId: string): Promise<number>;
  bumpSessionEpoch(shopId: string): Promise<number>;
  /** Records `id` as used until `expiresAt`. False if it was already used: one-time links and challenges. */
  consumeOnce(id: string, expiresAt: Date): Promise<boolean>;
}

export function generateSecret(prefix: 'sk_agent' | 'sk_owner'): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class Access {
  private readonly store: AccessStore;
  private readonly sessionSecret: string;

  constructor(store: AccessStore, sessionSecret: string) {
    if (sessionSecret.length < 16) throw new Error('Session secret must be at least 16 characters');
    this.store = store;
    this.sessionSecret = sessionSecret;
  }

  /** New shop: returns the owner secret once. */
  async createOwner(shopId: string, secret = generateSecret('sk_owner')): Promise<string> {
    await this.store.setOwnerHash(shopId, hashSecret(secret));
    return secret;
  }

  async hasOwner(shopId: string): Promise<boolean> {
    return Boolean(await this.store.ownerHash(shopId));
  }

  async checkOwnerSecret(shopId: string, secret: string): Promise<boolean> {
    const stored = await this.store.ownerHash(shopId);
    return Boolean(stored) && safeEqual(stored!, hashSecret(secret));
  }

  /** Issue an agent key for a shop; returns the key once. */
  async createAgentKey(shopId: string, label: string, secret = generateSecret('sk_agent')): Promise<{ key: AgentKey; secret: string }> {
    const key: AgentKey = {
      id: `key_${randomBytes(6).toString('hex')}`,
      shopId,
      label: label.slice(0, 60) || 'agent',
      hash: hashSecret(secret),
      hint: secret.slice(-4),
      createdAt: new Date().toISOString(),
    };
    await this.store.putKey(key);
    return { key, secret };
  }

  /** The hosted demo's shared key (a known secret), active and marked shared: created if missing, re-enabled if revoked. */
  async ensureSharedKey(shopId: string, label: string, secret: string): Promise<AgentKey> {
    const existing = await this.store.keyByHash(hashSecret(secret));
    if (existing && existing.shopId !== shopId) throw new Error('That key belongs to another shop');
    const key: AgentKey = { ...(existing ?? (await this.createAgentKey(shopId, label, secret)).key), revokedAt: undefined, shared: true };
    await this.store.putKey(key);
    return key;
  }

  /** Resolve an `Authorization: Bearer sk_agent_...` header. Owner secrets are not agent keys. */
  async agentFromHeader(header: string | null | undefined): Promise<AgentKey | undefined> {
    const secret = /^Bearer\s+(sk_agent_[A-Za-z0-9_-]+)$/.exec(header ?? '')?.[1];
    if (!secret) return undefined;
    const key = await this.store.keyByHash(hashSecret(secret));
    if (!key || key.revokedAt) return undefined;
    const now = Date.now();
    if (!key.lastUsedAt || now - Date.parse(key.lastUsedAt) > LAST_USED_RESOLUTION_MS) {
      await this.store.putKey({ ...key, lastUsedAt: new Date(now).toISOString() });
    }
    return key;
  }

  /** Returns false if the shop has no such key. A shared key can't be revoked: the next visitor needs it. */
  async revokeKey(shopId: string, keyId: string): Promise<boolean> {
    const key = (await this.store.listKeys(shopId)).find((k) => k.id === keyId);
    if (!key) return false;
    if (key.shared) throw new HttpError(403, 'This key is shared with everyone trying the demo, so it stays. Revoke any key you made.');
    await this.store.putKey({ ...key, revokedAt: new Date().toISOString() });
    return true;
  }

  listKeys(shopId: string): Promise<AgentKey[]> {
    return this.store.listKeys(shopId);
  }

  /**
   * Signed, expiring owner session for a cookie: "<shopId>.<issued>.<expires>.<kind>.<via>.<epoch>.<hmac>".
   * A "demo" session is the shared public one for the demo shop: it can decide, sees buyers' details
   * masked, and can't change the shop. The epoch ties it to the shop's current session generation, so
   * "sign out everywhere" ends every copy of it.
   */
  async signOwnerSession(shopId: string, options: { ttlMs?: number; now?: number; kind?: OwnerSession['kind']; via?: OwnerSession['via'] } = {}): Promise<string> {
    const now = options.now ?? Date.now();
    const epoch = await this.store.sessionEpoch(shopId);
    const payload = [shopId, now, now + (options.ttlMs ?? SESSION_TTL_MS), options.kind ?? 'owner', options.via ?? 'signin', epoch].join('.');
    return `${payload}.${this.hmac(`session:${payload}`)}`;
  }

  /** The session, or undefined if it is forged, expired or from before the last "sign out everywhere". */
  async verifyOwnerSession(token: string | undefined, now = Date.now()): Promise<OwnerSession | undefined> {
    const parts = token?.split('.') ?? [];
    if (parts.length !== 7) return undefined;
    const [shopId, issued, expires, kind, via, epoch, sig] = parts;
    if (!safeEqual(sig, this.hmac(`session:${parts.slice(0, 6).join('.')}`))) return undefined;
    if ((kind !== 'owner' && kind !== 'demo') || (via !== 'signin' && via !== 'switch' && via !== 'handoff')) return undefined;
    if (Number(expires) <= now || Number(epoch) !== (await this.store.sessionEpoch(shopId))) return undefined;
    return { shopId, kind, via, issuedAt: Number(issued), expiresAt: Number(expires) };
  }

  /** Ends every session of the shop, on every device (this one too). */
  async signOutEverywhere(shopId: string): Promise<void> {
    await this.store.bumpSessionEpoch(shopId);
  }

  /** A credential was shown on this device within the last few minutes (not a shop switch or another device's link). */
  isFresh(session: OwnerSession, now = Date.now()): boolean {
    return session.via === 'signin' && now - session.issuedAt < FRESH_SESSION_MS;
  }

  /**
   * A token that signs another device in to the session's shop, once, within a few minutes. The new
   * session ends when this one does, so a link can't stretch a sign-in past its week.
   */
  issueHandoff(session: OwnerSession, expiresAt: number, now = Date.now()): string {
    return this.signValue(HANDOFF, `${session.shopId}:${randomBytes(12).toString('base64url')}:${expiresAt}`, HANDOFF_TTL_MS, now);
  }

  /** The shop a handoff token opens and when its session ends, or undefined if forged, expired or already used. */
  async redeemHandoff(token: unknown, now = Date.now()): Promise<{ shopId: string; expiresAt: number } | undefined> {
    const [shopId, nonce, expires] = this.verifyValue(HANDOFF, token, now)?.split(':') ?? [];
    const expiresAt = Number(expires);
    if (!shopId || !nonce || !(expiresAt > now)) return undefined;
    return (await this.store.consumeOnce(`handoff:${nonce}`, new Date(now + HANDOFF_TTL_MS))) ? { shopId, expiresAt } : undefined;
  }

  /** Use a one-time id (a challenge nonce). False if it was used already. */
  consumeOnce(id: string, expiresAt: Date): Promise<boolean> {
    return this.store.consumeOnce(id, expiresAt);
  }

  /**
   * A signed, expiring token for one value, bound to what it is for: "<value>.<expiresMs>.<hmac>". A
   * claim token can't be passed off as a seller token, and neither can be edited or outlive `ttlMs`.
   */
  signValue(purpose: string, value: string, ttlMs: number, now = Date.now()): string {
    const payload = `${value}.${now + ttlMs}`;
    return `${payload}.${this.hmac(`${purpose}:${payload}`)}`;
  }

  /** The value, or undefined if the token is forged, expired or for another purpose. */
  verifyValue(purpose: string, token: unknown, now = Date.now()): string | undefined {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) return undefined;
    const [value, expires, sig] = parts;
    if (!safeEqual(sig, this.hmac(`${purpose}:${value}.${expires}`))) return undefined;
    return Number(expires) > now ? value : undefined;
  }

  private hmac(payload: string): string {
    return createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class MemoryAccessStore implements AccessStore {
  private readonly owners = new Map<string, string>();
  private readonly keys = new Map<string, AgentKey>();

  async setOwnerHash(shopId: string, hash: string) {
    this.owners.set(shopId, hash);
  }
  async ownerHash(shopId: string) {
    return this.owners.get(shopId);
  }
  async putKey(key: AgentKey) {
    this.keys.set(key.id, structuredClone(key));
  }
  async keyByHash(hash: string) {
    const key = [...this.keys.values()].find((k) => k.hash === hash);
    return key && structuredClone(key);
  }
  async listKeys(shopId: string) {
    return [...this.keys.values()].filter((k) => k.shopId === shopId).map((k) => structuredClone(k));
  }
  private readonly epochs = new Map<string, number>();
  private readonly used = new Map<string, number>();
  async sessionEpoch(shopId: string) {
    return this.epochs.get(shopId) ?? 0;
  }
  async bumpSessionEpoch(shopId: string) {
    const next = (this.epochs.get(shopId) ?? 0) + 1;
    this.epochs.set(shopId, next);
    return next;
  }
  async consumeOnce(id: string, expiresAt: Date) {
    const now = Date.now();
    for (const [k, until] of this.used) if (until <= now) this.used.delete(k);
    if (this.used.has(id)) return false;
    this.used.set(id, expiresAt.getTime());
    return true;
  }
}
