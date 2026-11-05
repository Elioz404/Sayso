// Shop lifecycle: onboard (AI draft) -> owner reviews -> publish (PayPal Catalog Products) -> live for
// buyer agents. Onboarding keeps the seller's photos on the products they show, and where the seller
// gave no price it asks the market what similar items sell for; that is only a suggestion, and the shop
// can't be published until the owner confirms every price. Creating a shop also returns a first agent key for the owner's own AI agent, once. The
// owner signs in with PayPal; where PayPal sign-in isn't set up, they get an owner secret instead, once.

import type { Access } from './access.ts';
import { draftCatalog, type OnboardingInput } from './ai/onboarding.ts';
import type { ChatModel } from './ai/llm.ts';
import { type Catalog, findVariant, isLive, pricesToConfirm, type PriceSuggestion, type Product, variantLabel, variantTitle } from './catalog.ts';
import { knownTimeZone } from './days.ts';
import { fromLlmError, HttpError, notFound } from './errors.ts';
import type { Links } from './links.ts';
import type { MarketPrices } from './market.ts';
import { checkPhotos, MAX_DRAFT_PHOTOS, mediaIdOf, photoFromDataUrl, type MediaStore, type StoredPhoto } from './media.ts';
import { MAX_STOCK } from './limits.ts';
import { formatMoney, parseAmount } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { createCatalogProduct } from './paypal/products.ts';
import type { CatalogStore } from './stores.ts';

export interface ShopsDeps {
  catalogs: CatalogStore;
  access: Access;
  paypal: PayPalClient;
  /** The public pool (Start selling). */
  model?: ChatModel;
  /** Signed-in owners' pool (drafts from photos); the public one when not given. */
  ownerModel?: ChatModel;
  links: Links;
  /** Where sellers' photos are kept; without it, products start without pictures. */
  media?: MediaStore;
  /** Price suggestions for drafts without prices; without it, those prices start at zero. */
  market?: MarketPrices;
}

/** Products whose missing prices are looked up in the market, per new shop (each lookup costs a search). */
const SUGGESTED_PRODUCTS = 6;
/** Drafts a shop keeps waiting at once; the oldest go first. */
const MAX_DRAFTS = 12;

export interface OnboardResult {
  catalog: Catalog;
  questions: string[];
  /** Only when the owner signs in with a secret instead of PayPal. */
  ownerSecret?: string;
  /** Only when asked for (the CLI's `sayso init`); the web flow connects agents later, from Agents. */
  agentKey?: string;
}

/**
 * What the owner changes in a draft before publishing, as typed: amounts like "56" or "56.00". A price
 * given for a variant is the owner's, even when it is the suggested one: giving it confirms it.
 */
export interface DraftEdits {
  shopName?: string;
  products?: {
    id: string;
    name?: string;
    description?: string;
    remove?: boolean;
    variants?: VariantEdit[];
  }[];
  shipping?: ShippingEdit[];
}

/** One option of a product, as typed. Amounts as text, like "24.50". */
export interface VariantEdit {
  id: string;
  title?: string;
  price?: string;
  inventory?: number;
  /**
   * The stock the editor saw. When given with `inventory`, the edit is refused if the stock moved since
   * (a sale, say), so a sale is never written over.
   */
  expectedInventory?: number;
}

/** A shipping method's price and free-shipping threshold, as typed ("8.95"; empty or null: no threshold). */
export interface ShippingEdit {
  id: string;
  price?: string;
  freeAbove?: string | null;
}

/** What an owner (or their agent) may change on a product that is on sale. Amounts as text, like "24.50". */
export interface ProductEdits {
  name?: string;
  description?: string;
  variants?: VariantEdit[];
  /** A new photo, as a data URL (owner only). */
  photo?: string;
}

export class Shops {
  private readonly deps: ShopsDeps;

  constructor(deps: ShopsDeps) {
    this.deps = deps;
  }

  /** `ownerSecret: false` when the owner will claim the shop by signing in with PayPal; `agentKey: false` when no agent connects yet. */
  async onboard(input: OnboardingInput, agentLabel = 'my agent', options: { ownerSecret: boolean; agentKey?: boolean } = { ownerSecret: true }): Promise<OnboardResult> {
    if (!this.deps.model) throw new HttpError(503, 'Onboarding needs an AI key (OPENAI_API_KEY or DEEPSEEK_API_KEY) on the server');
    const { catalog, questions, photoOf } = await draftCatalog(this.deps.model, input).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not read that catalog');
    });
    const timeZone = knownTimeZone(input.timeZone);
    if (timeZone) catalog.shop.timeZone = timeZone;
    await this.keepPhotos(catalog, input.images ?? [], photoOf);
    await this.suggestPrices(catalog);
    questions.push(...priceQuestions(catalog));
    await this.deps.catalogs.save(catalog);
    const ownerSecret = options.ownerSecret ? await this.deps.access.createOwner(catalog.shop.id) : undefined;
    const agentKey = options.agentKey === false ? undefined : (await this.deps.access.createAgentKey(catalog.shop.id, agentLabel)).secret;
    return { catalog, questions, ownerSecret, ...(agentKey ? { agentKey } : {}) };
  }

  /**
   * The browser that drafted the shop (or its owner) only, while it is still a draft. Applies the owner's
   * edits: names, descriptions, prices (confirming them), stock, shipping, pieces taken out. Everything is
   * checked before anything changes, so a bad amount changes nothing.
   */
  async reviewDraft(shopId: string, edits: DraftEdits): Promise<Catalog> {
    const draft = await this.get(shopId);
    if (isLive(draft)) throw new HttpError(409, 'This shop is already live; change it from your dashboard');
    const currency = draft.shop.currency;
    const prices = new Map<string, number>();
    for (const p of edits.products ?? []) {
      const product = draft.products.find((x) => x.id === p.id);
      if (!product || p.remove) continue;
      for (const v of p.variants ?? []) {
        const variant = product.variants.find((x) => x.id === v.id);
        if (!variant) continue;
        const what = variantLabel(product.name, variant.title);
        if (v.price !== undefined) prices.set(variant.id, amountOf(v.price, currency, what));
        checkStock(v.inventory, what);
      }
    }
    const removed = new Set((edits.products ?? []).filter((p) => p.remove).map((p) => p.id));
    if (draft.products.every((p) => removed.has(p.id))) throw new HttpError(400, 'Keep at least one piece in your shop');
    const shipping = shippingChanges(draft, edits.shipping ?? [], false);
    const name = cleanName(edits.shopName, SHOP_NAME, 'A shop name');

    const updated = await this.deps.catalogs.modify(shopId, (catalog) => {
      if (isLive(catalog)) return false;
      if (name) catalog.shop.name = name;
      catalog.products = catalog.products.filter((p) => !removed.has(p.id));
      for (const p of edits.products ?? []) {
        const product = catalog.products.find((x) => x.id === p.id);
        if (!product) continue;
        if (p.name?.trim()) product.name = p.name.trim().slice(0, PRODUCT_NAME.max);
        if (p.description !== undefined) product.description = p.description.trim().slice(0, DESCRIPTION_MAX);
        for (const v of p.variants ?? []) {
          const variant = product.variants.find((x) => x.id === v.id);
          if (!variant) continue;
          if (v.title?.trim()) variant.title = v.title.trim().slice(0, OPTION_NAME.max);
          if (prices.has(variant.id)) {
            variant.price = prices.get(variant.id)!;
            delete variant.priceToConfirm; // the owner gave this price, even if it is the suggestion
          }
          if (v.inventory !== undefined) variant.inventory = v.inventory;
        }
      }
      applyShipping(catalog, shipping);
      return true;
    });
    if (!updated && isLive(await this.get(shopId))) throw new HttpError(409, 'This shop is already live; change it from your dashboard');
    return updated ?? (await this.get(shopId));
  }

  /**
   * Owner only. The shop's name as buyers and assistants see it. Its address (slug) stays the same, so
   * links and MCP URLs already shared keep working.
   */
  async rename(shopId: string, name: string): Promise<Catalog> {
    const clean = cleanName(name, SHOP_NAME, 'A shop name')!;
    const renamed = await this.deps.catalogs.modify(shopId, (catalog) => {
      if (catalog.shop.name === clean) return false;
      catalog.shop.name = clean;
      return true;
    });
    return renamed ?? this.get(shopId);
  }

  /** Owner only. Registers products with PayPal and opens the shop to buyer agents. */
  async publish(shopId: string): Promise<{ catalog: Catalog; warnings: string[] }> {
    const catalog = await this.get(shopId);
    const unpriced = pricesToConfirm(catalog);
    if (unpriced.length) {
      const names = unpriced.map(({ product, variant }) => variantLabel(product.name, variant.title));
      throw new HttpError(409, `Confirm the price of ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} before publishing`);
    }
    const warnings: string[] = [];
    const registered = new Map<string, string>();
    for (const product of catalog.products) {
      if (product.paypalProductId) continue;
      const result = await this.registerWithPayPal(catalog, product);
      if (typeof result === 'string') registered.set(product.id, result);
      else warnings.push(`${product.name}: not registered in PayPal's catalog (${result.error})`);
    }
    // The PayPal calls take a while; apply their results to the catalog as it is now, not as it was.
    const published = await this.deps.catalogs.modify(shopId, (current) => {
      for (const product of current.products) product.paypalProductId ??= registered.get(product.id);
      current.shop.status = 'live';
      return true;
    });
    return { catalog: published ?? catalog, warnings };
  }

  /**
   * Set one option's price (as typed, "24.50") and/or stock. The owner's grid and the agent's tool both
   * land here, and it is the same edit as `editProduct`, so they follow the same checks.
   */
  async setVariant(shopId: string, variantId: string, edit: Omit<VariantEdit, 'id' | 'title'>): Promise<Catalog> {
    if (edit.price === undefined && edit.inventory === undefined) throw new HttpError(400, 'Send a price, a stock count or both');
    const found = findVariant(await this.get(shopId), variantId);
    if (!found) throw notFound(`Variant ${variantId}`);
    return this.editProduct(shopId, found.product.id, { variants: [{ id: variantId, ...edit }] });
  }

  /**
   * The owner (or their agent) edits a product on sale: name, description, each option's name, price
   * and stock, and, for the owner, its photo. Everything is checked before anything changes.
   */
  async editProduct(shopId: string, productId: string, edits: ProductEdits): Promise<Catalog> {
    const catalog = await this.get(shopId);
    const product = catalog.products.find((p) => p.id === productId);
    if (!product) throw notFound(`Product ${productId}`);
    const currency = catalog.shop.currency;
    const name = cleanName(edits.name, PRODUCT_NAME, 'A name');
    if (edits.description !== undefined && edits.description.length > DESCRIPTION_MAX) throw new HttpError(400, 'A description is up to 2,000 characters');
    const prices = new Map<string, number>();
    for (const v of edits.variants ?? []) {
      const variant = product.variants.find((x) => x.id === v.id);
      if (!variant) throw notFound(`Option ${v.id}`);
      const what = variantLabel(product.name, variant.title);
      if (v.price !== undefined) prices.set(variant.id, amountOf(v.price, currency, what));
      checkStock(v.inventory, what);
      cleanName(v.title, OPTION_NAME, 'An option name');
    }
    let photo: StoredPhoto | undefined;
    if (edits.photo !== undefined) {
      photo = photoFromDataUrl(checkPhotos([edits.photo], 1)[0], shopId);
      if (!photo || !this.deps.media) throw new HttpError(400, 'That photo could not be kept');
      await this.deps.media.put(photo);
    }
    const old = product.imageUrl;
    let moved: { title: string; inventory: number } | undefined;
    const updated = await this.deps.catalogs.modify(shopId, (c) => {
      const p = c.products.find((x) => x.id === productId);
      if (!p) return false;
      for (const v of edits.variants ?? []) {
        const variant = p.variants.find((x) => x.id === v.id);
        if (variant && v.inventory !== undefined && v.expectedInventory !== undefined && variant.inventory !== v.expectedInventory) moved = variant;
      }
      if (moved) return false;
      if (name) p.name = name;
      if (edits.description !== undefined) p.description = edits.description.trim();
      if (photo) p.imageUrl = this.deps.links.media(photo.id);
      for (const v of edits.variants ?? []) {
        const variant = p.variants.find((x) => x.id === v.id);
        if (!variant) continue;
        if (v.title !== undefined) variant.title = v.title.trim();
        if (prices.has(variant.id)) {
          variant.price = prices.get(variant.id)!;
          delete variant.priceToConfirm;
        }
        if (v.inventory !== undefined) variant.inventory = v.inventory;
      }
      return true;
    });
    if (moved) {
      if (photo) await this.deps.media?.remove(shopId, [photo.id]);
      throw new HttpError(409, `${variantLabel(product.name, moved.title)} now has ${moved.inventory} in stock (it changed while you were editing). Check it and save again.`);
    }
    if (!updated) throw notFound(`Product ${productId}`);
    if (photo && old && !updated.products.some((p) => p.imageUrl === old)) await this.forgetPhotos(shopId, [{ ...product, imageUrl: old }]);
    return updated;
  }

  /** Owner only. Takes a product off sale for good, with its photo. A shop keeps at least one product. */
  async removeProduct(shopId: string, productId: string): Promise<Catalog> {
    const last = 'A shop keeps at least one product; add another before removing this one';
    if ((await this.get(shopId)).products.length <= 1) throw new HttpError(409, last);
    let removed: Product | undefined;
    const updated = await this.deps.catalogs.modify(shopId, (c) => {
      removed = c.products.find((p) => p.id === productId);
      if (!removed || c.products.length <= 1) return false;
      c.products = c.products.filter((p) => p.id !== productId);
      // Orders keep pointing at these ids, so a later product never takes them.
      c.retired = [...new Set([...(c.retired ?? []), removed.id, ...removed.variants.map((v) => v.id)])];
      return true;
    });
    if (!updated || !removed) throw notFound(`Product ${productId}`);
    if (removed.imageUrl && !updated.products.some((p) => p.imageUrl === removed!.imageUrl)) await this.forgetPhotos(shopId, [removed]);
    return updated;
  }

  /** Owner only. Shipping prices and the free-shipping threshold of each method, as amounts like "8.95". */
  async editShipping(shopId: string, edits: ShippingEdit[]): Promise<Catalog> {
    const catalog = await this.get(shopId);
    const changes = shippingChanges(catalog, edits, true);
    const updated = await this.deps.catalogs.modify(shopId, (c) => {
      applyShipping(c, changes);
      return true;
    });
    return updated ?? catalog;
  }

  /**
   * Photos from the owner's phone -> draft products for a shop that already exists: named, described,
   * with the photo and a market price suggestion. They wait in `drafts` until the owner puts them on sale.
   */
  async draftFromPhotos(shopId: string, images: string[], note = ''): Promise<Product[]> {
    const model = this.deps.ownerModel ?? this.deps.model;
    if (!model) throw new HttpError(503, 'Drafting from photos needs an AI key (OPENAI_API_KEY or DEEPSEEK_API_KEY) on the server');
    const photos = checkPhotos(images, MAX_DRAFT_PHOTOS);
    const { shop } = await this.get(shopId);
    const text = note.trim() || 'New items for this shop. One product per photo, unless several photos show the same item.';
    const { catalog: draft, photoOf } = await draftCatalog(model, { text, images: photos, currency: shop.currency, country: shop.country, shopName: shop.name }).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not read those photos');
    });
    draft.shop = { ...draft.shop, id: shopId, currency: shop.currency };
    await this.keepPhotos(draft, photos, photoOf);
    await this.suggestPrices(draft);

    let added: Product[] = [];
    let dropped: Product[] = [];
    await this.deps.catalogs.modify(shopId, (catalog) => {
      const taken = new Set([...[...catalog.products, ...(catalog.drafts ?? [])].flatMap((p) => [p.id, ...p.variants.map((v) => v.id)]), ...(catalog.retired ?? [])]);
      const unique = (id: string) => {
        let next = id;
        for (let n = 2; taken.has(next); n++) next = `${id}_${n}`;
        taken.add(next);
        return next;
      };
      added = draft.products.map((p) => {
        const id = unique(p.id);
        return { ...p, id, shopId, variants: p.variants.map((v) => ({ ...v, id: unique(v.id), productId: id, priceToConfirm: v.priceToConfirm ?? {} })) };
      });
      const all = [...(catalog.drafts ?? []), ...added];
      dropped = all.slice(0, Math.max(0, all.length - MAX_DRAFTS));
      catalog.drafts = all.slice(-MAX_DRAFTS);
      return true;
    });
    await this.forgetPhotos(shopId, dropped);
    return added;
  }

  /**
   * Put a draft on sale at the owner's prices and stock (minor units, per variant). On a live shop it is
   * registered with PayPal's catalog like every other product.
   */
  async releaseDraft(shopId: string, productId: string, variants: { id: string; price: number; inventory: number }[], name?: string, description?: string): Promise<Catalog> {
    for (const v of variants) {
      if (!Number.isSafeInteger(v.price) || v.price <= 0) throw new HttpError(400, 'Every price must be a positive amount');
      checkStock(v.inventory, 'Stock');
    }
    const draft = (await this.get(shopId)).drafts?.find((p) => p.id === productId);
    if (!draft) throw notFound(`Draft ${productId}`);
    if (draft.variants.some((variant) => !variants.some((v) => v.id === variant.id))) throw new HttpError(400, 'Set a price and stock for every option of that draft');

    const updated = await this.deps.catalogs.modify(shopId, (catalog) => {
      const current = catalog.drafts?.find((p) => p.id === productId);
      if (!current) return false;
      for (const variant of current.variants) {
        const set = variants.find((v) => v.id === variant.id)!;
        variant.price = set.price;
        variant.inventory = set.inventory;
        delete variant.priceToConfirm;
      }
      if (name?.trim()) current.name = name.trim().slice(0, PRODUCT_NAME.max);
      if (description !== undefined) current.description = description.trim().slice(0, DESCRIPTION_MAX);
      catalog.drafts = catalog.drafts!.filter((p) => p.id !== productId);
      catalog.products.push(current);
      return true;
    });
    if (!updated) throw notFound(`Draft ${productId}`);
    const product = updated.products.find((p) => p.id === productId)!;
    if (!isLive(updated)) return updated;

    // Checkout doesn't depend on PayPal's catalog: if this fails, the next publish retries it.
    const registered = await this.registerWithPayPal(updated, product);
    if (typeof registered !== 'string') return updated;
    return (
      (await this.deps.catalogs.modify(shopId, (catalog) => {
        const p = catalog.products.find((x) => x.id === productId);
        if (p) p.paypalProductId ??= registered;
        return Boolean(p);
      })) ?? updated
    );
  }

  /** Throw a draft away, with its photo. */
  async discardDraft(shopId: string, productId: string): Promise<void> {
    let removed: Product | undefined;
    const updated = await this.deps.catalogs.modify(shopId, (catalog) => {
      removed = catalog.drafts?.find((p) => p.id === productId);
      catalog.drafts = catalog.drafts?.filter((p) => p.id !== productId);
      return Boolean(removed);
    });
    if (!updated || !removed) throw notFound(`Draft ${productId}`);
    await this.forgetPhotos(shopId, [removed]);
  }

  /** Register a product in PayPal's catalog. Its id, or why it failed. */
  private async registerWithPayPal(catalog: Catalog, product: Product): Promise<string | { error: string }> {
    try {
      const created = await createCatalogProduct(
        this.deps.paypal,
        { name: product.name, description: product.description, imageUrl: product.imageUrl && this.deps.links.asset(product.imageUrl), homeUrl: this.deps.links.shopPage(catalog.shop.slug) },
        `${catalog.shop.id}-${product.id}-catalog`,
      );
      return created.id;
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'error' };
    }
  }

  /** Each product gets the photo the model said shows it, stored (as the shop's) and served from this site. */
  private async keepPhotos(catalog: Catalog, images: string[], photoOf: Record<string, number>): Promise<void> {
    const media = this.deps.media;
    if (!media) return;
    const stored = new Map<number, string>();
    for (const product of catalog.products) {
      const index = photoOf[product.id];
      if (index === undefined || !images[index]) continue;
      if (!stored.has(index)) {
        const photo = photoFromDataUrl(images[index], catalog.shop.id);
        if (!photo) continue;
        await media.put(photo);
        stored.set(index, this.deps.links.media(photo.id));
      }
      product.imageUrl = stored.get(index);
    }
  }

  /** Delete the stored photos of products that are gone. */
  private async forgetPhotos(shopId: string, products: Product[]): Promise<void> {
    const ids = products.map((p) => mediaIdOf(p.imageUrl)).filter((id): id is string => Boolean(id));
    if (ids.length) await this.deps.media?.remove(shopId, ids);
  }

  /** Unpriced variants start at what similar items sell for, flagged until the owner confirms. */
  private async suggestPrices(catalog: Catalog): Promise<void> {
    const market = this.deps.market;
    if (!market) return;
    const { currency, id: shopId } = catalog.shop;
    const unpriced = catalog.products.filter((p) => p.variants.some((v) => v.priceToConfirm)).slice(0, SUGGESTED_PRODUCTS);
    // Each lookup is a search that can take seconds: ask for all of them at once.
    const suggestions = await Promise.all(unpriced.map((product) => market.suggest(product, currency, shopId).catch(() => undefined))); // a suggestion is optional
    unpriced.forEach((product, i) => {
      const suggested = suggestions[i];
      if (!suggested) return;
      for (const variant of product.variants) {
        if (!variant.priceToConfirm) continue;
        variant.price = suggested.median;
        variant.priceToConfirm = { suggested };
      }
    });
  }

  async get(shopId: string): Promise<Catalog> {
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw notFound(`Shop ${shopId}`);
    return catalog;
  }
}

/** One question per product whose price the owner still has to confirm: the suggestion, or a plain ask. */
function priceQuestions(catalog: Catalog): string[] {
  const money = (minor: number) => formatMoney(minor, catalog.shop.currency);
  const byProduct = new Map<string, { name: string; titles: string[]; suggested?: PriceSuggestion }>();
  for (const { product, variant } of pricesToConfirm(catalog)) {
    const entry = byProduct.get(product.id) ?? { name: product.name, titles: [], suggested: variant.priceToConfirm?.suggested };
    if (variantTitle(variant.title)) entry.titles.push(variant.title);
    byProduct.set(product.id, entry);
  }
  return [...byProduct.values()].map(({ name, titles, suggested }) => {
    const what = titles.length ? `${name} (${titles.join(', ')})` : name;
    return suggested
      ? `${what}: similar items sell for ${money(suggested.low)} to ${money(suggested.high)} (${suggested.listings} listings), so Sayso put ${money(suggested.median)}. Keep it or set your own before publishing.`
      : `What does ${what} cost? Set a price before publishing.`;
  });
}

const SHOP_NAME = { min: 2, max: 60 };
const PRODUCT_NAME = { min: 2, max: 120 };
const OPTION_NAME = { min: 1, max: 80 };
const DESCRIPTION_MAX = 2_000;

/** An amount typed by a person or a model ("24.50") in minor units; `zeroOk` where free is a real price. */
function amountOf(value: string, currency: string, what: string, zeroOk = false): number {
  const minor = parseAmount(value, currency);
  if (minor === undefined || minor < 0 || (!zeroOk && minor === 0)) throw new HttpError(400, `${what}: write an amount like 24.50`);
  return minor;
}

function checkStock(value: number | undefined, what: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > MAX_STOCK)) {
    throw new HttpError(400, `${what}: stock is a whole number from 0 to ${MAX_STOCK.toLocaleString('en-US')}`);
  }
}

/** A name with its spaces tidied, or undefined when none was given; refused outside its length. */
function cleanName(value: string | undefined, length: { min: number; max: number }, what: string): string | undefined {
  const clean = value?.trim().replace(/\s+/g, ' ');
  if (clean !== undefined && (clean.length < length.min || clean.length > length.max)) throw new HttpError(400, `${what} is ${length.min} to ${length.max} characters`);
  return clean;
}

type ShippingChange = { price?: number; freeAbove?: number | null };

/** Shipping edits checked against the catalog, in minor units. `strict`: an unknown method is an error, not skipped. */
function shippingChanges(catalog: Catalog, edits: readonly ShippingEdit[], strict: boolean): Map<string, ShippingChange> {
  const currency = catalog.shop.currency;
  const changes = new Map<string, ShippingChange>();
  for (const e of edits) {
    const rule = catalog.shop.shipping.find((x) => x.id === e.id);
    if (!rule) {
      if (strict) throw notFound(`Shipping method ${e.id}`);
      continue;
    }
    changes.set(rule.id, {
      ...(e.price !== undefined ? { price: amountOf(e.price, currency, `Shipping (${rule.name})`, true) } : {}),
      ...(e.freeAbove !== undefined ? { freeAbove: e.freeAbove === null || e.freeAbove.trim() === '' ? null : amountOf(e.freeAbove, currency, 'Free shipping above') } : {}),
    });
  }
  return changes;
}

function applyShipping(catalog: Catalog, changes: ReadonlyMap<string, ShippingChange>): void {
  for (const rule of catalog.shop.shipping) {
    const change = changes.get(rule.id);
    if (!change) continue;
    if (change.price !== undefined) rule.price = change.price;
    if (change.freeAbove === null) delete rule.freeAbove;
    else if (change.freeAbove !== undefined) rule.freeAbove = change.freeAbove;
  }
}
