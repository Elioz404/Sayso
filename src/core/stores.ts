// Storage contracts for shops and carts, with in-memory implementations for tests and the zero-config
// local demo. Production uses the Postgres implementations in src/server/pg-stores.ts.

import { isListed, type Catalog, type StockLine } from './catalog.ts';
import type { PayPalCart } from './cart/spec.ts';

export interface StoredCart {
  id: string;
  shopId: string;
  cart: PayPalCart;
  orderId?: string;
  /** Total the PayPal order was created for; a re-priced cart with a new total needs a new order. */
  orderTotal?: string;
  /** Where the buyer approves the current PayPal order. */
  approvalUrl?: string;
  authorizationId?: string;
  captureId?: string;
  /** When the capture went through: the buyer has paid. */
  paidAt?: string;
  /** Who paid, as PayPal reports it. Trust decisions use this, never the email typed into the cart. */
  payerEmail?: string;
  /** Made-to-order lead time of each cart line when the order was placed (null: from stock). */
  makeDays?: (number | null)[];
  guardRecordId?: string;
  /** The order number the owner and the buyer see, e.g. SAY-7K2M9QXD. */
  merchantOrderNumber?: string;
  /** Stock taken for this order, given back if the order is released. */
  reserved?: StockLine[];
  /** The order will not go through (capture rejected or failed): when, why, and whether PayPal confirmed the hold is gone. */
  released?: { at: string; reason: string; holdVoided: boolean };
  tracking?: { carrier: string; number: string; addedAt: string };
  /** How the buyer paid: approved in PayPal (default), or with their saved PayPal within their limits. */
  paidWith?: 'saved-paypal';
  /** The owner's own PayPal merchant id the PayPal order pays into. Missing: Sayso's account. */
  payee?: string;
  /** Who was shopping, as far as we know: e.g. "chatgpt", "mcp-client". */
  channel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CartStore {
  get(id: string): Promise<StoredCart | undefined>;
  put(cart: StoredCart): Promise<void>;
  /** Carts of a shop, newest first. */
  listByShop(shopId: string, limit?: number): Promise<StoredCart[]>;
  /** Placed orders that still stand (completed, not released), newest first. */
  listPlaced(shopId: string, limit?: number): Promise<StoredCart[]>;
  /** A placed order by the number people see (case-insensitive). */
  byNumber(shopId: string, number: string): Promise<StoredCart | undefined>;
  /** Has this PayPal account (by email) paid the shop for an order before? */
  paidBy(shopId: string, email: string): Promise<boolean>;
}

export interface CatalogStore {
  byShopId(shopId: string): Promise<Catalog | undefined>;
  bySlug(slug: string): Promise<Catalog | undefined>;
  save(catalog: Catalog): Promise<void>;
  /** Published, listed shops: what buyers' assistants can browse. */
  listLive(): Promise<Catalog[]>;
  /** Every shop a seller owns, drafts and private ones too, newest first. */
  listBySeller(sellerId: string): Promise<Catalog[]>;
  remove(shopId: string): Promise<void>;
  /**
   * Change a catalog atomically: `change` edits it and returns true to save, false to leave it as it
   * was. Nothing else writes the catalog in between, so a checkout taking the last unit and the owner
   * editing a price can't overwrite each other. Returns the saved catalog, or undefined if nothing was saved.
   */
  modify(shopId: string, change: (catalog: Catalog) => boolean): Promise<Catalog | undefined>;
}

export class MemoryCartStore implements CartStore {
  private readonly carts = new Map<string, StoredCart>();
  async get(id: string) {
    const c = this.carts.get(id);
    return c && structuredClone(c);
  }
  async put(cart: StoredCart) {
    this.carts.set(cart.id, structuredClone(cart));
  }
  async listByShop(shopId: string, limit = Infinity) {
    return this.ofShop(shopId).slice(0, limit).map((c) => structuredClone(c));
  }
  async listPlaced(shopId: string, limit = Infinity) {
    return this.ofShop(shopId)
      .filter((c) => c.cart.status === 'COMPLETED' && !c.released)
      .slice(0, limit)
      .map((c) => structuredClone(c));
  }
  async byNumber(shopId: string, number: string) {
    const c = this.ofShop(shopId).find((x) => x.merchantOrderNumber?.toUpperCase() === number.toUpperCase());
    return c && structuredClone(c);
  }
  async paidBy(shopId: string, email: string) {
    return this.ofShop(shopId).some((c) => c.captureId && c.payerEmail?.toLowerCase() === email.toLowerCase());
  }
  private ofShop(shopId: string): StoredCart[] {
    return [...this.carts.values()].filter((c) => c.shopId === shopId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class MemoryCatalogStore implements CatalogStore {
  private readonly catalogs = new Map<string, Catalog>();
  constructor(catalogs: Catalog[] = []) {
    for (const c of catalogs) this.catalogs.set(c.shop.id, structuredClone(c));
  }
  async byShopId(shopId: string) {
    const c = this.catalogs.get(shopId);
    return c && structuredClone(c);
  }
  async bySlug(slug: string) {
    const c = [...this.catalogs.values()].find((x) => x.shop.slug === slug);
    return c && structuredClone(c);
  }
  async save(catalog: Catalog) {
    this.catalogs.set(catalog.shop.id, structuredClone(catalog));
  }
  async listLive() {
    return [...this.catalogs.values()].filter(isListed).map((c) => structuredClone(c));
  }
  async listBySeller(sellerId: string) {
    return [...this.catalogs.values()]
      .filter((c) => c.shop.sellerId === sellerId)
      .sort((a, b) => (b.shop.createdAt ?? '').localeCompare(a.shop.createdAt ?? ''))
      .map((c) => structuredClone(c));
  }
  async remove(shopId: string) {
    this.catalogs.delete(shopId);
  }
  // Synchronous between reading and writing, which is all the atomicity one process needs.
  async modify(shopId: string, change: (catalog: Catalog) => boolean) {
    const current = this.catalogs.get(shopId);
    if (!current) return undefined;
    const draft = structuredClone(current);
    if (!change(draft)) return undefined;
    this.catalogs.set(shopId, draft);
    return structuredClone(draft);
  }
}
