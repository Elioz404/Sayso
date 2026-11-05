// Postgres implementations of the core store interfaces, used when DATABASE_URL is set (Render).
// One JSON document table keeps the schema trivial; the columns next to `data` exist only for lookups,
// and filters run in SQL so pages never load more rows than they show.

import 'server-only';
import pg from 'pg';
import { paidByPayer, type PayerRef } from '@/core/stores.ts';
import type { AccessStore, AgentKey } from '@/core/access.ts';
import type { Catalog } from '@/core/catalog.ts';
import type { Policy } from '@/core/guard/policy.ts';
import type { PolicyStore } from '@/core/guard/policy-store.ts';
import type { JobNotes, JobStore } from '@/core/production.ts';
import type { Tour, TourStore } from '@/core/tour.ts';
import type { GuardRecord, GuardStore, RecordQuery, RecordStatus } from '@/core/guard/types.ts';
import type { CartStore, CatalogStore, PlacedQuery, StoredCart } from '@/core/stores.ts';
import type { SpendStore } from '@/core/ai/llm.ts';
import type { MediaStore, StoredPhoto } from '@/core/media.ts';
import type { Passkey, PasskeyStore } from '@/core/passkeys.ts';
import type { PushStore, PushSubscriptionRecord } from '@/core/push.ts';
import type { Seller, SellerStore } from '@/core/sellers.ts';
import type { Wallet, WalletStore } from '@/core/wallets.ts';

const SCHEMA = `
create table if not exists sayso_docs (
  kind text not null,
  id text not null,
  owner text,
  slug text,
  hash text,
  created_at timestamptz not null default now(),
  data jsonb not null,
  primary key (kind, id)
);
create index if not exists sayso_docs_owner on sayso_docs (kind, owner, created_at desc);
create unique index if not exists sayso_docs_slug on sayso_docs (kind, slug) where slug is not null;
create index if not exists sayso_docs_hash on sayso_docs (kind, hash) where hash is not null;
-- Guard reads: a shop's records by status (what counts as spent), by cart (an order's history) and by kind.
create index if not exists sayso_guard_status on sayso_docs (owner, (data->>'status'), created_at desc) where kind = 'guard';
create index if not exists sayso_guard_cart on sayso_docs ((data->'action'->'params'->>'cartId')) where kind = 'guard';
create index if not exists sayso_guard_kind on sayso_docs (owner, (data->'action'->>'kind'), created_at desc) where kind = 'guard';
-- A buyer's orders across shops, by the PayPal account that paid.
create index if not exists sayso_cart_payer on sayso_docs ((data->>'payerId')) where kind = 'cart';
-- A shop's placed orders, newest first (orders, sales, production), without scanning abandoned carts.
create index if not exists sayso_cart_placed on sayso_docs (owner, created_at desc) where kind = 'cart' and data->'cart'->>'status' = 'COMPLETED';
create index if not exists sayso_cart_payer_email on sayso_docs (lower(data->>'payerEmail')) where kind = 'cart';
`;

type Kind = 'catalog' | 'cart' | 'guard' | 'owner' | 'key' | 'policy' | 'wallet' | 'wallet-key' | 'jobs' | 'tour' | 'seller' | 'media' | 'passkey' | 'push' | 'epoch' | 'once' | 'ai-spend';
type Queryable = pg.Pool | pg.PoolClient;

interface Doc {
  kind: Kind;
  id: string;
  owner?: string;
  /** A unique public name within the kind: a shop's slug, an order number. */
  slug?: string;
  hash?: string;
  createdAt?: string;
  data: unknown;
}

/** Rows a read returns unless the caller asks for a number (pages ask for fewer, Guard for more). */
const DEFAULT_ROWS = 500;
const MAX_ROWS = 5_000;

export class Db {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 5,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async migrate(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async put(doc: Doc, client: Queryable = this.pool): Promise<void> {
    await client.query(
      `insert into sayso_docs (kind, id, owner, slug, hash, created_at, data)
       values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now()), $7)
       on conflict (kind, id) do update set owner = $3, slug = $4, hash = $5, data = $7`,
      [doc.kind, doc.id, doc.owner ?? null, doc.slug ?? null, doc.hash ?? null, doc.createdAt ?? null, JSON.stringify(doc.data)],
    );
  }

  async get<T>(kind: Kind, id: string): Promise<T | undefined> {
    const { rows } = await this.pool.query('select data from sayso_docs where kind = $1 and id = $2', [kind, id]);
    return rows[0]?.data as T | undefined;
  }

  async one<T>(kind: Kind, column: 'slug' | 'hash', value: string): Promise<T | undefined> {
    const { rows } = await this.pool.query(`select data from sayso_docs where kind = $1 and ${column} = $2 limit 1`, [kind, value]);
    return rows[0]?.data as T | undefined;
  }

  /** Newest first. `where` is extra SQL over `data`, with its parameters numbered from $3. */
  async list<T>(kind: Kind, owner: string | null, options: { where?: string[]; params?: unknown[]; limit?: number } = {}): Promise<T[]> {
    const where = ['kind = $1', '($2::text is null or owner = $2)', ...(options.where ?? [])];
    const params = [kind, owner, ...(options.params ?? [])];
    const { rows } = await this.pool.query(
      `select data from sayso_docs where ${where.join(' and ')} order by created_at desc limit ${Math.min(Math.max(1, Math.trunc(options.limit ?? DEFAULT_ROWS)), MAX_ROWS)}`,
      params,
    );
    return rows.map((r) => r.data as T);
  }

  /** Delete one document by kind and id. */
  async remove(kind: Kind, id: string): Promise<void> {
    await this.pool.query('delete from sayso_docs where kind = $1 and id = $2', [kind, id]);
  }

  /** Run `work` in a transaction, rolling back if it throws. */
  async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}

/** Public shops change rarely and are read on every buyer search and crawl: kept for a short while. */
const LIVE_SHOPS_TTL_MS = 30_000;

export class PgCatalogStore implements CatalogStore {
  private readonly db: Db;
  private live?: { at: number; shops: Promise<Catalog[]> };
  constructor(db: Db) {
    this.db = db;
  }
  byShopId(shopId: string) {
    return this.db.get<Catalog>('catalog', shopId);
  }
  bySlug(slug: string) {
    return this.db.one<Catalog>('catalog', 'slug', slug);
  }
  async save(catalog: Catalog, client?: Queryable) {
    await this.db.put({ kind: 'catalog', id: catalog.shop.id, owner: catalog.shop.sellerId, slug: catalog.shop.slug, createdAt: catalog.shop.createdAt, data: catalog }, client);
    this.live = undefined;
  }
  /** Every public live shop, read once per LIVE_SHOPS_TTL_MS (and again after any change made here). */
  async listLive() {
    if (!this.live || Date.now() - this.live.at > LIVE_SHOPS_TTL_MS) {
      const shops = this.db.list<Catalog>('catalog', null, {
        where: ["coalesce(data->'shop'->>'status', 'live') = 'live'", "coalesce(data->'shop'->>'visibility', 'public') = 'public'"],
      });
      this.live = { at: Date.now(), shops };
      shops.catch(() => (this.live = undefined)); // a failed read is not remembered
    }
    return structuredClone(await this.live.shops); // callers get their own copy
  }
  listBySeller(sellerId: string) {
    return this.db.list<Catalog>('catalog', sellerId);
  }
  async remove(shopId: string) {
    await this.db.remove('catalog', shopId);
    this.live = undefined;
  }
  /** Row-locked, so two checkouts can't both take the last mug and an edit can't undo a sale. */
  modify(shopId: string, change: (catalog: Catalog) => boolean) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query("select data from sayso_docs where kind = 'catalog' and id = $1 for update", [shopId]);
      const catalog = rows[0]?.data as Catalog | undefined;
      if (!catalog || !change(catalog)) return undefined;
      await this.save(catalog, client);
      return catalog;
    });
  }
}

export class PgCartStore implements CartStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  get(id: string) {
    return this.db.get<StoredCart>('cart', id);
  }
  async put(cart: StoredCart) {
    await this.db.put({ kind: 'cart', id: cart.id, owner: cart.shopId, slug: cart.merchantOrderNumber, createdAt: cart.createdAt, data: cart });
  }
  listByShop(shopId: string, limit?: number) {
    return this.db.list<StoredCart>('cart', shopId, { limit });
  }
  listPlaced(shopId: string, query: PlacedQuery) {
    const where = ["data->'cart'->>'status' = 'COMPLETED'", ...(query.released ? [] : ["data->'released' is null"]), ...(query.since ? ['created_at >= $3::timestamptz'] : [])];
    return this.db.list<StoredCart>('cart', shopId, { where, params: query.since ? [query.since.toISOString()] : [], limit: query.limit });
  }
  async byNumber(shopId: string, number: string) {
    const cart = await this.db.one<StoredCart>('cart', 'slug', number.toUpperCase());
    return cart?.shopId === shopId ? cart : undefined;
  }
  async paidBy(shopId: string, email: string) {
    const found = await this.db.list<StoredCart>('cart', shopId, {
      where: ["data->>'captureId' is not null", "lower(data->>'payerEmail') = $3"],
      params: [email.toLowerCase()],
      limit: 1,
    });
    return found.length > 0;
  }
  async listByPayer(payer: PayerRef, limit = 50) {
    if (!payer.payerId && !payer.email) return [];
    // Candidates by either key; the same rule as in memory picks the ones that are really this payer's.
    const found = await this.db.list<StoredCart>('cart', null, {
      where: ["data->'cart'->>'status' = 'COMPLETED'", "(data->>'payerId' = $3 or lower(data->>'payerEmail') = $4)"],
      params: [payer.payerId ?? '', (payer.email ?? '').toLowerCase()],
      limit,
    });
    return found.filter((c) => paidByPayer(c, payer));
  }
}

export class PgGuardStore implements GuardStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  /** A session advisory lock per owner, held on its own connection while `work` reads and writes. */
  async exclusive<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    const client = await this.db.pool.connect();
    try {
      await client.query('select pg_advisory_lock(hashtext($1))', [`guard:${ownerId}`]);
      try {
        return await work();
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [`guard:${ownerId}`]);
      }
    } finally {
      client.release();
    }
  }
  async insert(record: GuardRecord) {
    await this.db.put(this.doc(record));
  }
  async update(record: GuardRecord) {
    await this.db.put(this.doc(record));
  }
  async updateIf(record: GuardRecord, expected: RecordStatus) {
    const { rowCount } = await this.db.pool.query(
      "update sayso_docs set data = $3 where kind = 'guard' and id = $1 and data->>'status' = $2",
      [record.id, expected, JSON.stringify(record)],
    );
    return rowCount === 1;
  }
  get(id: string) {
    return this.db.get<GuardRecord>('guard', id);
  }
  list(ownerId: string, query: RecordQuery = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(sql(`$${params.length + 2}`));
    };
    if (query.since) add((n) => `created_at >= ${n}::timestamptz`, query.since.toISOString());
    if (query.status !== undefined) add((n) => `data->>'status' = any(${n}::text[])`, ([] as RecordStatus[]).concat(query.status));
    if (query.kind) add((n) => `data->'action'->>'kind' = ${n}`, query.kind);
    if (query.cartId) add((n) => `data->'action'->'params'->>'cartId' = ${n}`, query.cartId);
    if (query.cartIds) add((n) => `data->'action'->'params'->>'cartId' = any(${n}::text[])`, query.cartIds);
    return this.db.list<GuardRecord>('guard', ownerId, { where, params, limit: query.limit });
  }
  private doc(record: GuardRecord): Doc {
    return { kind: 'guard', id: record.id, owner: record.action.ownerId, createdAt: record.createdAt, data: record };
  }
}

export class PgAccessStore implements AccessStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  async setOwnerHash(shopId: string, hash: string) {
    await this.db.put({ kind: 'owner', id: shopId, owner: shopId, data: { hash } });
  }
  async ownerHash(shopId: string) {
    return (await this.db.get<{ hash: string }>('owner', shopId))?.hash;
  }
  async putKey(key: AgentKey) {
    await this.db.put({ kind: 'key', id: key.id, owner: key.shopId, hash: key.hash, createdAt: key.createdAt, data: key });
  }
  async touchKey(id: string, at: string) {
    await this.db.pool.query(`update sayso_docs set data = jsonb_set(data, '{lastUsedAt}', to_jsonb($2::text)) where kind = 'key' and id = $1 and data->>'revokedAt' is null`, [id, at]);
  }
  async revokeKey(id: string, at: string) {
    await this.db.pool.query(`update sayso_docs set data = jsonb_set(data, '{revokedAt}', to_jsonb($2::text)) where kind = 'key' and id = $1 and data->>'revokedAt' is null`, [id, at]);
  }
  keyByHash(hash: string) {
    return this.db.one<AgentKey>('key', 'hash', hash);
  }
  listKeys(shopId: string) {
    return this.db.list<AgentKey>('key', shopId);
  }
  async sessionEpoch(shopId: string) {
    return (await this.db.get<{ epoch: number }>('epoch', shopId))?.epoch ?? 0;
  }
  async bumpSessionEpoch(shopId: string) {
    const { rows } = await this.db.pool.query(
      `insert into sayso_docs (kind, id, owner, data) values ('epoch', $1, $1, '{"epoch":1}')
       on conflict (kind, id) do update set data = jsonb_build_object('epoch', (sayso_docs.data->>'epoch')::int + 1)
       returning (data->>'epoch')::int as epoch`,
      [shopId],
    );
    return rows[0].epoch as number;
  }
  async consumeOnce(id: string, expiresAt: Date) {
    const { rowCount } = await this.db.pool.query(
      `insert into sayso_docs (kind, id, created_at, data) values ('once', $1, now(), jsonb_build_object('expiresAt', $2::text))
       on conflict (kind, id) do nothing`,
      [id, expiresAt.toISOString()],
    );
    return rowCount === 1;
  }
}

export class PgPolicyStore implements PolicyStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  get(ownerId: string) {
    return this.db.get<Policy>('policy', ownerId);
  }
  async put(policy: Policy) {
    await this.db.put({ kind: 'policy', id: policy.ownerId, owner: policy.ownerId, data: policy });
  }
}

/** One document per shop holding its job notes by job id; they are few and always read together. */
export class PgJobStore implements JobStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  async list(shopId: string) {
    return (await this.db.get<Record<string, JobNotes>>('jobs', shopId)) ?? {};
  }
  /** One statement, so two first notes for a shop arriving together can't lose one. */
  async update(shopId: string, jobId: string, notes: JobNotes) {
    await this.db.pool.query(
      `insert into sayso_docs (kind, id, owner, data) values ('jobs', $1, $1, jsonb_build_object($2::text, $3::jsonb))
       on conflict (kind, id) do update set data = sayso_docs.data || jsonb_build_object($2::text, coalesce(sayso_docs.data -> $2, '{}'::jsonb) || $3::jsonb)`,
      [shopId, jobId, JSON.stringify(notes)],
    );
  }
}

export class PgTourStore implements TourStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  async put(tour: Tour) {
    await this.db.put({ kind: 'tour', id: tour.id, owner: tour.shopId, createdAt: tour.createdAt, data: tour });
  }
  async byShop(shopId: string) {
    return (await this.db.list<Tour>('tour', shopId, { limit: 1 }))[0];
  }
  expired(now: Date) {
    return this.db.list<Tour>('tour', null, { where: ["(data->>'expiresAt')::timestamptz <= $3"], params: [now.toISOString()] });
  }
  async remove(id: string) {
    await this.db.remove('tour', id);
  }
}

export class PgWalletStore implements WalletStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  async put(wallet: Wallet) {
    await this.db.put({ kind: 'wallet', id: wallet.id, hash: wallet.hash, createdAt: wallet.createdAt, data: wallet });
  }
  get(id: string) {
    return this.db.get<Wallet>('wallet', id);
  }
  async byHash(hash: string) {
    const direct = await this.db.one<Wallet>('wallet', 'hash', hash);
    if (direct) return direct;
    const alias = await this.db.one<{ walletId: string }>('wallet-key', 'hash', hash);
    return alias ? this.get(alias.walletId) : undefined;
  }
  async addKey(walletId: string, hash: string) {
    await this.db.put({ kind: 'wallet-key', id: hash, owner: walletId, hash, data: { walletId } });
  }
  async removeKeys(walletId: string) {
    await this.db.pool.query("delete from sayso_docs where kind = 'wallet-key' and owner = $1", [walletId]);
  }
}

export class PgSellerStore implements SellerStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  get(id: string) {
    return this.db.get<Seller>('seller', id);
  }
  byPayPalUser(paypalUserId: string) {
    return this.db.one<Seller>('seller', 'hash', paypalUserId);
  }
  async put(seller: Seller) {
    await this.db.put({ kind: 'seller', id: seller.id, hash: seller.paypalUserId, createdAt: seller.createdAt, data: seller });
  }
}

export class PgMediaStore implements MediaStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  get(id: string) {
    return this.db.get<StoredPhoto>('media', id);
  }
  async put(photo: StoredPhoto) {
    await this.db.put({ kind: 'media', id: photo.id, owner: photo.shopId, createdAt: photo.createdAt, data: photo });
  }
  async remove(shopId: string, ids: string[]) {
    if (ids.length) await this.db.pool.query("delete from sayso_docs where kind = 'media' and owner = $1 and id = any($2)", [shopId, ids]);
  }
  async removeShop(shopId: string) {
    await this.db.pool.query("delete from sayso_docs where kind = 'media' and owner = $1", [shopId]);
  }
}

export class PgPasskeyStore implements PasskeyStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  list(shopId: string) {
    return this.db.list<Passkey>('passkey', shopId, { limit: 20 });
  }
  get(id: string) {
    return this.db.get<Passkey>('passkey', id);
  }
  async put(passkey: Passkey) {
    await this.db.put({ kind: 'passkey', id: passkey.id, owner: passkey.shopId, createdAt: passkey.createdAt, data: passkey });
  }
  async remove(id: string) {
    await this.db.remove('passkey', id);
  }
}

export class PgPushStore implements PushStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  list(shopId: string) {
    return this.db.list<PushSubscriptionRecord>('push', shopId, { limit: 20 });
  }
  async put(subscription: PushSubscriptionRecord) {
    await this.db.put({ kind: 'push', id: subscription.id, owner: subscription.shopId, createdAt: subscription.createdAt, data: subscription });
  }
  async remove(id: string) {
    await this.db.remove('push', id);
  }
}
export class PgSpendStore implements SpendStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  async get(day: string) {
    return (await this.db.get<{ usd: number; calls: number }>('ai-spend', day)) ?? { usd: 0, calls: 0 };
  }
  async add(day: string, usd: number) {
    await this.db.pool.query(
      `insert into sayso_docs (kind, id, data) values ('ai-spend', $1, jsonb_build_object('usd', $2::float8, 'calls', 1))
       on conflict (kind, id) do update set data = jsonb_build_object('usd', (sayso_docs.data->>'usd')::float8 + $2::float8, 'calls', (sayso_docs.data->>'calls')::int + 1)`,
      [day, usd],
    );
  }
}
