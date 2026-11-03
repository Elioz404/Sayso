// Seller accounts: a person who signed in with PayPal, and the shops they own. Signing in is PayPal's
// job (see paypal/identity.ts); this keeps who they are and which shops are theirs.
//
// A shop becomes a seller's in one of two ways, both proved by Sayso and never by the caller's word:
// the browser that just created it claims it (a short-lived signed claim), or an owner already signed in
// to it links their PayPal.

import { randomBytes } from 'node:crypto';
import type { Catalog } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import type { PayPalIdentity } from './paypal/identity.ts';
import type { CatalogStore } from './stores.ts';

export interface Seller {
  id: string;
  /** PayPal's stable id for this person (Log in with PayPal's user_id). */
  paypalUserId: string;
  /** Their PayPal account id. */
  payerId?: string;
  email?: string;
  name?: string;
  verified: boolean;
  createdAt: string;
  lastSignInAt: string;
}

export interface SellerStore {
  get(id: string): Promise<Seller | undefined>;
  byPayPalUser(paypalUserId: string): Promise<Seller | undefined>;
  put(seller: Seller): Promise<void>;
}

export class Sellers {
  private readonly store: SellerStore;
  private readonly catalogs: CatalogStore;

  constructor(deps: { store: SellerStore; catalogs: CatalogStore }) {
    this.store = deps.store;
    this.catalogs = deps.catalogs;
  }

  /** The seller for this PayPal identity, created on first sign-in and refreshed after. */
  async signIn(identity: PayPalIdentity, now = new Date()): Promise<Seller> {
    const existing = await this.store.byPayPalUser(identity.userId);
    const seller: Seller = {
      id: existing?.id ?? `sel_${randomBytes(8).toString('hex')}`,
      paypalUserId: identity.userId,
      payerId: identity.payerId ?? existing?.payerId,
      email: identity.email ?? existing?.email,
      name: identity.name ?? existing?.name,
      verified: identity.verified,
      createdAt: existing?.createdAt ?? now.toISOString(),
      lastSignInAt: now.toISOString(),
    };
    await this.store.put(seller);
    return seller;
  }

  get(sellerId: string): Promise<Seller | undefined> {
    return this.store.get(sellerId);
  }

  /** Newest first. Tour copies are never a seller's, so they never show up here. */
  shops(sellerId: string): Promise<Catalog[]> {
    return this.catalogs.listBySeller(sellerId);
  }

  /** Make `shopId` the seller's. A shop that already belongs to someone else stays theirs. */
  async claim(shopId: string, sellerId: string): Promise<Catalog> {
    let taken = false;
    const claimed = await this.catalogs.modify(shopId, (catalog) => {
      if (catalog.shop.sellerId === sellerId) return false;
      if (catalog.shop.sellerId || catalog.shop.visibility === 'private') {
        taken = true;
        return false;
      }
      catalog.shop.sellerId = sellerId;
      return true;
    });
    if (taken) throw new HttpError(409, 'That shop belongs to another PayPal account');
    const catalog = claimed ?? (await this.catalogs.byShopId(shopId));
    if (!catalog) throw notFound(`Shop ${shopId}`);
    return catalog;
  }

  /** Does this seller own this shop? */
  async owns(sellerId: string, shopId: string): Promise<boolean> {
    return (await this.catalogs.byShopId(shopId))?.shop.sellerId === sellerId;
  }
}

export class MemorySellerStore implements SellerStore {
  private readonly sellers = new Map<string, Seller>();
  async get(id: string) {
    const s = this.sellers.get(id);
    return s && structuredClone(s);
  }
  async byPayPalUser(paypalUserId: string) {
    const s = [...this.sellers.values()].find((x) => x.paypalUserId === paypalUserId);
    return s && structuredClone(s);
  }
  async put(seller: Seller) {
    this.sellers.set(seller.id, structuredClone(seller));
  }
}
