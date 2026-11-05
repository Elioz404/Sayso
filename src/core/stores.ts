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
  /** When the buyer approved the payment and the order took its stock: the order was placed. */
  placedAt?: string;
  /** When the capture went through: the buyer has paid. */
  paidAt?: string;
  /** Who paid, as PayPal reports it. Trust decisions use this, never the email typed into the cart. */
  payerEmail?: string;
  /** The PayPal account that paid (PayPal's payer id): how a buyer who signs in with PayPal finds their orders. */
  payerId?: string;
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
  /** Disputes the buyer opened in PayPal about this order, as PayPal reports them (newest state). */
  disputes?: OrderDispute[];
  /** How the buyer paid: approved in PayPal (default), or with their saved PayPal within their limits. */
  paidWith?: 'saved-paypal';
  /** With saved PayPal: the buyer's own Guard record that allowed it, released too if the order is. */
  buyerRecordId?: string;
  /** The owner's own PayPal merchant id the PayPal order pays into. Missing: Sayso's account. */
  payee?: string;
  /** Who was shopping, as far as we know: e.g. "chatgpt", "mcp-client". */
  channel?: string;
  createdAt: string;
  updatedAt: string;
}

/** A buyer's dispute in PayPal: the owner answers it in PayPal's Resolution Center, by `respondBy`. */
export interface OrderDispute {
  id: string;
  /** PayPal's reason code, e.g. MERCHANDISE_OR_SERVICE_NOT_RECEIVED. */
  reason: string;
  /** PayPal's status, e.g. WAITING_FOR_SELLER_RESPONSE, RESOLVED. */
  status: string;
  /** Minor units, in the order's currency. */
  amount: number;
  currency: string;
  openedAt: string;
  updatedAt: string;
  respondBy?: string;
  /** How it ended, once resolved (PayPal's outcome code). */
  outcome?: string;
}

export interface CartStore {
  get(id: string): Promise<StoredCart | undefined>;
  put(cart: StoredCart): Promise<void>;
  /** Carts of a shop, newest first. */
  listByShop(shopId: string, limit: number): Promise<StoredCart[]>;
  /**
   * Placed orders, newest first: completed, and still standing unless `released` asks for cancelled ones
   * too. `since`: placed (created) at or after then. `limit` is required, so every caller says how many.
   */
  listPlaced(shopId: string, options: PlacedQuery): Promise<StoredCart[]>;
  /** A placed order by the number people see (case-insensitive). */
  byNumber(shopId: string, number: string): Promise<StoredCart | undefined>;
  /** Has this PayPal account (by email) paid the shop for an order before? */
  paidBy(shopId: string, email: string): Promise<boolean>;
  /** Orders a PayPal account paid for, in every shop, newest first: by its payer id, or by its email for orders saved without one. */
  listByPayer(payer: PayerRef, limit?: number): Promise<StoredCart[]>;
  /** The order a PayPal payment belongs to: by its capture id or its authorization id. */
  byPayment(paypalId: string): Promise<StoredCart | undefined>;
}

export interface PlacedQuery {
  limit: number;
  since?: Date;
  /** Include orders the shop cancelled (released). */
  released?: boolean;
}

/** A PayPal account as PayPal itself reported it (never an email someone typed). */
export interface PayerRef {
  payerId?: string;
  email?: string;
}

/** Whether `cart` was paid by `payer`. */
export function paidByPayer(cart: StoredCart, payer: PayerRef): boolean {
  if (cart.cart.status !== 'COMPLETED' || !cart.merchantOrderNumber) return false;
  if (payer.payerId && cart.payerId) return cart.payerId === payer.payerId;
  return Boolean(payer.email && cart.payerEmail && cart.payerEmail.toLowerCase() === payer.email.toLowerCase());
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
  /** The shop whose sales are paid into this PayPal merchant account, if any. */
  byPayoutMerchant(merchantId: string): Promise<Catalog | undefined>;
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
  async listByShop(shopId: string, limit: number) {
    return this.ofShop(shopId).slice(0, limit).map((c) => structuredClone(c));
  }
  async listPlaced(shopId: string, query: PlacedQuery) {
    return this.ofShop(shopId)
      .filter((c) => c.cart.status === 'COMPLETED' && (query.released || !c.released) && (!query.since || Date.parse(c.createdAt) >= query.since.getTime()))
      .slice(0, query.limit)
      .map((c) => structuredClone(c));
  }
  async byNumber(shopId: string, number: string) {
    const c = this.ofShop(shopId).find((x) => x.merchantOrderNumber?.toUpperCase() === number.toUpperCase());
    return c && structuredClone(c);
  }
  async paidBy(shopId: string, email: string) {
    return this.ofShop(shopId).some((c) => c.captureId && c.payerEmail?.toLowerCase() === email.toLowerCase());
  }
  async listByPayer(payer: PayerRef, limit = 50) {
    return [...this.carts.values()]
      .filter((c) => paidByPayer(c, payer))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((c) => structuredClone(c));
  }
  async byPayment(paypalId: string) {
    const c = [...this.carts.values()].find((x) => x.captureId === paypalId || x.authorizationId === paypalId);
    return c && structuredClone(c);
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
  async byPayoutMerchant(merchantId: string) {
    const c = [...this.catalogs.values()].find((x) => x.shop.payout?.merchantId === merchantId);
    return c && structuredClone(c);
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
