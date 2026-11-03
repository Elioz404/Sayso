// Postgres implementations of the core store interfaces, used when DATABASE_URL is set (Render).
// One JSON document table keeps the schema trivial; the columns next to `data` exist only for lookups.

import 'server-only';
import pg from 'pg';
import type { AccessStore, AgentKey } from '@/core/access.ts';
import { findVariant, type Catalog } from '@/core/catalog.ts';
import type { CartStore, CatalogStore, StoredCart } from '@/core/commerce.ts';
import type { Policy } from '@/core/guard/policy.ts';
import type { PolicyStore } from '@/core/guard/policy-store.ts';
import type { GuardRecord, GuardStore } from '@/core/guard/types.ts';
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

interface Doc {
  kind: Kind;
  id: string;
  owner?: string;
  slug?: string;
  hash?: string;
  createdAt?: string;
  data: unknown;
}

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

  async put(doc: Doc, client: pg.Pool | pg.PoolClient = this.pool): Promise<void> {
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

  async list<T>(kind: Kind, owner?: string, since?: Date): Promise<T[]> {
    const { rows } = await this.pool.query(
      `select data from sayso_docs
       where kind = $1 and ($2::text is null or owner = $2) and ($3::timestamptz is null or created_at >= $3)
       order by created_at desc limit 1000`,
      [kind, owner ?? null, since?.toISOString() ?? null],
    );
    return rows.map((r) => r.data as T);
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
  async save(catalog: Catalog) {
    await this.db.put({ kind: 'catalog', id: catalog.shop.id, slug: catalog.shop.slug, createdAt: catalog.shop.createdAt, data: catalog });
  }
  list() {
    return this.db.list<Catalog>('catalog');
  }
  /** Row-locked so two checkouts can't both take the last mug. */
  async decrementInventory(shopId: string, variantId: string, quantity: number) {
    const client = await this.db.pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query("select data from sayso_docs where kind = 'catalog' and id = $1 for update", [shopId]);
      const catalog = rows[0]?.data as Catalog | undefined;
      const found = catalog && findVariant(catalog, variantId);
      if (catalog && found && found.variant.madeToOrderDays === undefined) {
        found.variant.inventory = Math.max(0, found.variant.inventory - quantity);
        await this.db.put({ kind: 'catalog', id: shopId, slug: catalog.shop.slug, data: catalog }, client);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
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
    await this.db.put({ kind: 'cart', id: cart.id, owner: cart.shopId, createdAt: cart.createdAt, data: cart });
  }
  listByShop(shopId: string) {
    return this.db.list<StoredCart>('cart', shopId);
  }
}

export class PgGuardStore implements GuardStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }
  async insert(record: GuardRecord) {
    await this.db.put({ kind: 'guard', id: record.id, owner: record.action.ownerId, createdAt: record.createdAt, data: record });
  }
  update(record: GuardRecord) {
    return this.insert(record);
  }
  get(id: string) {
    return this.db.get<GuardRecord>('guard', id);
  }
  listSince(ownerId: string, since: Date) {
    return this.db.list<GuardRecord>('guard', ownerId, since);
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
