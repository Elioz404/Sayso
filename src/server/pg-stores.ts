// Postgres implementations of the core store interfaces, used when DATABASE_URL is set (Render).
// One JSON document table keeps the schema trivial; the columns next to `data` exist only for lookups,
// and filters run in SQL so pages never load more rows than they show.

import 'server-only';
import pg from 'pg';
import type { AccessStore, AgentKey } from '@/core/access.ts';
import { returnStock, takeStock, type Catalog, type StockLine } from '@/core/catalog.ts';
import type { Policy } from '@/core/guard/policy.ts';
import type { PolicyStore } from '@/core/guard/policy-store.ts';
import type { GuardRecord, GuardStore, RecordQuery, RecordStatus } from '@/core/guard/types.ts';
import type { CartStore, CatalogStore, StoredCart } from '@/core/stores.ts';
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
`;

type Kind = 'catalog' | 'cart' | 'guard' | 'owner' | 'key' | 'policy' | 'wallet' | 'wallet-key';
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

/** Most rows any single read returns; callers ask for fewer. */
const MAX_ROWS = 500;

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
      `select data from sayso_docs where ${where.join(' and ')} order by created_at desc limit ${Math.min(options.limit ?? MAX_ROWS, MAX_ROWS)}`,
      params,
    );
    return rows.map((r) => r.data as T);
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

export class PgCatalogStore implements CatalogStore {
  private readonly db: Db;
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
    await this.db.put({ kind: 'catalog', id: catalog.shop.id, slug: catalog.shop.slug, createdAt: catalog.shop.createdAt, data: catalog }, client);
  }
  listLive() {
    return this.db.list<Catalog>('catalog', null, { where: ["coalesce(data->'shop'->>'status', 'live') = 'live'"] });
  }
  /** Row-locked, so two checkouts can't both take the last mug. */
  takeStock(shopId: string, lines: readonly StockLine[]) {
    return this.locked(shopId, (catalog) => takeStock(catalog, lines));
  }
  async returnStock(shopId: string, lines: readonly StockLine[]) {
    await this.locked(shopId, (catalog) => {
      returnStock(catalog, lines);
      return true;
    });
  }
  /** Load the catalog under a row lock, let `change` edit it, and save it if `change` returns true. */
  private locked(shopId: string, change: (catalog: Catalog) => boolean): Promise<boolean> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query("select data from sayso_docs where kind = 'catalog' and id = $1 for update", [shopId]);
      const catalog = rows[0]?.data as Catalog | undefined;
      if (!catalog || !change(catalog)) return false;
      await this.save(catalog, client);
      return true;
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
  async byNumber(shopId: string, number: string) {
    const cart = await this.db.one<StoredCart>('cart', 'slug', number.toUpperCase());
    return cart?.shopId === shopId ? cart : undefined;
  }
  async paidBy(shopId: string, email: string) {
    const found = await this.db.list<StoredCart>('cart', shopId, {
      where: ["data->>'captureId' is not null", "lower(data->'cart'->'customer'->>'email_address') = $3"],
      params: [email.toLowerCase()],
      limit: 1,
    });
    return found.length > 0;
  }
}

export class PgGuardStore implements GuardStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
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
  keyByHash(hash: string) {
    return this.db.one<AgentKey>('key', 'hash', hash);
  }
  listKeys(shopId: string) {
    return this.db.list<AgentKey>('key', shopId);
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
}
