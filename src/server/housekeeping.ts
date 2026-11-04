// What the hourly sweep deletes from Postgres: everything that belonged to an expired tour copy (or its
// lent wallet), carts abandoned before they were paid, and one-time codes past their expiry. Kept in
// one place so nothing that belongs to a shop is forgotten when the shop goes.
import 'server-only';
import type { Housekeeping } from '@/core/tour.ts';
import type { Db } from './pg-stores.ts';

/** Kinds of document stored with `owner` = the shop's id. */
const SHOP_KINDS = ['cart', 'guard', 'key', 'policy', 'jobs', 'tour', 'passkey', 'push', 'media', 'epoch', 'owner'];
/** Unpaid carts older than this are gone; PayPal has let their orders expire long before. */
const ABANDONED_AFTER = '2 days';

export class PgHousekeeping implements Housekeeping {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  async forgetShop(shopId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query('delete from sayso_docs where kind = any($1::text[]) and owner = $2', [SHOP_KINDS, shopId]);
      await client.query("delete from sayso_docs where kind = 'catalog' and id = $1", [shopId]);
    });
  }

  async forgetWallet(walletId: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query("delete from sayso_docs where kind in ('wallet-key', 'guard', 'policy') and owner = $1", [walletId]);
      await client.query("delete from sayso_docs where kind = 'wallet' and id = $1", [walletId]);
    });
  }

  /** Abandoned carts and spent one-time codes. Returns how many rows went. */
  async sweep(): Promise<{ carts: number; codes: number }> {
    const carts = await this.db.pool.query(
      `delete from sayso_docs where kind = 'cart' and created_at < now() - interval '${ABANDONED_AFTER}'
         and coalesce(data->'cart'->>'status', '') <> 'COMPLETED' and data->>'captureId' is null`,
    );
    const codes = await this.db.pool.query("delete from sayso_docs where kind = 'once' and (data->>'expiresAt')::timestamptz < now()");
    return { carts: carts.rowCount ?? 0, codes: codes.rowCount ?? 0 };
  }
}
