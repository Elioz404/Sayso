// Who may do what. Two kinds of credentials, deliberately separate:
//   - agent keys (sk_agent_...): what the owner's own AI agent holds. They can run the shop through the
//     tools, but money-moving actions go through Guard, and they can never approve a Guard record.
//   - the owner secret (sk_owner_...) and the signed owner session it unlocks: the only way to approve,
//     reject, publish a shop or change its policy.
// Secrets are stored as sha256 hashes and shown exactly once.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** "Last used" is shown to the owner; writing it on every call would turn each request into a write. */
const LAST_USED_RESOLUTION_MS = 10 * 60_000;

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
}

export interface AccessStore {
  setOwnerHash(shopId: string, hash: string): Promise<void>;
  ownerHash(shopId: string): Promise<string | undefined>;
  putKey(key: AgentKey): Promise<void>;
  keyByHash(hash: string): Promise<AgentKey | undefined>;
  listKeys(shopId: string): Promise<AgentKey[]>;
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

  /** A key with a known secret (the hosted demo's), active: re-enabled if it was revoked, created if missing. */
  async ensureAgentKey(shopId: string, label: string, secret: string): Promise<AgentKey> {
    const existing = await this.store.keyByHash(hashSecret(secret));
    if (!existing) return (await this.createAgentKey(shopId, label, secret)).key;
    if (existing.shopId !== shopId) throw new Error('That key belongs to another shop');
    if (existing.revokedAt) await this.store.putKey({ ...existing, revokedAt: undefined });
    return existing;
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

  /** Returns false if the shop has no such key. */
  async revokeKey(shopId: string, keyId: string): Promise<boolean> {
    const key = (await this.store.listKeys(shopId)).find((k) => k.id === keyId);
    if (!key) return false;
    await this.store.putKey({ ...key, revokedAt: new Date().toISOString() });
    return true;
  }

  listKeys(shopId: string): Promise<AgentKey[]> {
    return this.store.listKeys(shopId);
  }

  /** Signed, expiring owner session for a cookie: "<shopId>.<expiresMs>.<hmac>". */
  signOwnerSession(shopId: string, ttlMs = 7 * 86_400_000, now = Date.now()): string {
    const payload = `${shopId}.${now + ttlMs}`;
    return `${payload}.${this.hmac(payload)}`;
  }

  /** Returns the shop id the session belongs to, or undefined if it is forged or expired. */
  verifyOwnerSession(token: string | undefined, now = Date.now()): string | undefined {
    const parts = token?.split('.') ?? [];
    if (parts.length !== 3) return undefined;
    const [shopId, expires, sig] = parts;
    if (!safeEqual(sig, this.hmac(`${shopId}.${expires}`))) return undefined;
    return Number(expires) > now ? shopId : undefined;
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
}
