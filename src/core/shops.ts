// Shop lifecycle: onboard (AI draft) -> owner reviews -> publish (PayPal Catalog Products) -> live for
// buyer agents. Onboarding keeps the seller's photos on the products they show, and where the seller
// gave no price it asks the market what similar items sell for; that is only a suggestion, and the shop
// can't be published until the owner confirms every price. Creating a shop also returns a first agent key for the owner's own AI agent, once. The
// owner signs in with PayPal; where PayPal sign-in isn't set up, they get an owner secret instead, once.

import type { Access } from './access.ts';
import { draftCatalog, type OnboardingInput } from './ai/onboarding.ts';
import type { ChatModel } from './ai/llm.ts';
import { findVariant, pricesToConfirm, type Catalog, type PriceSuggestion } from './catalog.ts';
import { fromLlmError, HttpError, notFound } from './errors.ts';
import type { Links } from './links.ts';
import type { MarketPrices } from './market.ts';
import { photoFromDataUrl, type MediaStore } from './media.ts';
import { formatMoney } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { createCatalogProduct } from './paypal/products.ts';
import type { CatalogStore } from './stores.ts';

export interface ShopsDeps {
  catalogs: CatalogStore;
  access: Access;
  paypal: PayPalClient;
  model?: ChatModel;
  links: Links;
  /** Where sellers' photos are kept; without it, products start without pictures. */
  media?: MediaStore;
  /** Price suggestions for drafts without prices; without it, those prices start at zero. */
  market?: MarketPrices;
}

/** Products whose missing prices are looked up in the market, per new shop (each lookup costs a search). */
const SUGGESTED_PRODUCTS = 6;

export interface OnboardResult {
  catalog: Catalog;
  questions: string[];
  /** Only when the owner signs in with a secret instead of PayPal. */
  ownerSecret?: string;
  agentKey: string;
}

export class Shops {
  private readonly deps: ShopsDeps;

  constructor(deps: ShopsDeps) {
    this.deps = deps;
  }

  /** `ownerSecret: false` when the owner will claim the shop by signing in with PayPal. */
  async onboard(input: OnboardingInput, agentLabel = 'my agent', options: { ownerSecret: boolean } = { ownerSecret: true }): Promise<OnboardResult> {
    if (!this.deps.model) throw new HttpError(503, 'Onboarding needs an AI key (OPENAI_API_KEY or DEEPSEEK_API_KEY) on the server');
    const { catalog, questions, photoOf } = await draftCatalog(this.deps.model, input).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not read that catalog');
    });
    await this.keepPhotos(catalog, input.images ?? [], photoOf);
    await this.suggestPrices(catalog);
    questions.push(...priceQuestions(catalog));
    await this.deps.catalogs.save(catalog);
    const ownerSecret = options.ownerSecret ? await this.deps.access.createOwner(catalog.shop.id) : undefined;
    const { secret: agentKey } = await this.deps.access.createAgentKey(catalog.shop.id, agentLabel);
    return { catalog, questions, ownerSecret, agentKey };
  }

  /** Owner only. Registers products with PayPal and opens the shop to buyer agents. */
  async publish(shopId: string): Promise<{ catalog: Catalog; warnings: string[] }> {
    const catalog = await this.get(shopId);
    const unpriced = pricesToConfirm(catalog);
    if (unpriced.length) {
      const names = unpriced.map(({ product, variant }) => (variant.title === 'Default' ? product.name : `${product.name} (${variant.title})`));
      throw new HttpError(409, `Confirm the price of ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} before publishing`);
    }
    const warnings: string[] = [];
    const registered = new Map<string, string>();
    for (const product of catalog.products) {
      if (product.paypalProductId) continue;
      try {
        const created = await createCatalogProduct(
          this.deps.paypal,
          { name: product.name, description: product.description, imageUrl: product.imageUrl && this.deps.links.asset(product.imageUrl), homeUrl: this.deps.links.shopPage(catalog.shop.slug) },
          `${shopId}-${product.id}-catalog`,
        );
        registered.set(product.id, created.id);
      } catch (err) {
        // A catalog sync hiccup should not keep a seller offline; checkout doesn't depend on it.
        warnings.push(`${product.name}: not registered in PayPal's catalog (${err instanceof Error ? err.message : 'error'})`);
      }
    }
    // The PayPal calls take a while; apply their results to the catalog as it is now, not as it was.
    const published = await this.deps.catalogs.modify(shopId, (current) => {
      for (const product of current.products) product.paypalProductId ??= registered.get(product.id);
      current.shop.status = 'live';
      return true;
    });
    return { catalog: published ?? catalog, warnings };
  }

  /** Set a variant's price (minor units) and/or stock. The owner's grid and the agent's tool both land here. */
  async setVariant(shopId: string, variantId: string, patch: { price?: number; inventory?: number }): Promise<Catalog> {
    if (patch.price !== undefined && (!Number.isSafeInteger(patch.price) || patch.price <= 0)) throw new HttpError(400, 'Price must be a positive amount');
    if (patch.inventory !== undefined && (!Number.isSafeInteger(patch.inventory) || patch.inventory < 0)) throw new HttpError(400, 'Stock must be a whole number, 0 or more');
    const updated = await this.deps.catalogs.modify(shopId, (catalog) => {
      const found = findVariant(catalog, variantId);
      if (!found) return false;
      if (patch.price !== undefined) {
        found.variant.price = patch.price;
        delete found.variant.priceToConfirm; // setting a price, even the suggested one, is the owner's confirmation
      }
      if (patch.inventory !== undefined) found.variant.inventory = patch.inventory;
      return true;
    });
    if (!updated) throw notFound(`Variant ${variantId}`);
    return updated;
  }

  /** Each product gets the photo the model said shows it, stored and served from this site. */
  private async keepPhotos(catalog: Catalog, images: string[], photoOf: Record<string, number>): Promise<void> {
    const media = this.deps.media;
    if (!media) return;
    const stored = new Map<number, string>();
    for (const product of catalog.products) {
      const index = photoOf[product.id];
      if (index === undefined || !images[index]) continue;
      if (!stored.has(index)) {
        const photo = photoFromDataUrl(images[index]);
        if (!photo) continue;
        await media.put(photo);
        stored.set(index, this.deps.links.media(photo.id));
      }
      product.imageUrl = stored.get(index);
    }
  }

  /** Unpriced variants start at what similar items sell for, flagged until the owner confirms. */
  private async suggestPrices(catalog: Catalog): Promise<void> {
    const market = this.deps.market;
    if (!market) return;
    const { currency, id: shopId } = catalog.shop;
    const unpriced = catalog.products.filter((p) => p.variants.some((v) => v.priceToConfirm)).slice(0, SUGGESTED_PRODUCTS);
    for (const product of unpriced) {
      const suggested = await market.suggest(product, currency, shopId).catch(() => undefined); // a suggestion is optional
      if (!suggested) continue;
      for (const variant of product.variants) {
        if (!variant.priceToConfirm) continue;
        variant.price = suggested.median;
        variant.priceToConfirm = { suggested };
      }
    }
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
    if (variant.title !== 'Default') entry.titles.push(variant.title);
    byProduct.set(product.id, entry);
  }
  return [...byProduct.values()].map(({ name, titles, suggested }) => {
    const what = titles.length ? `${name} (${titles.join(', ')})` : name;
    return suggested
      ? `${what}: similar items sell for ${money(suggested.low)} to ${money(suggested.high)} (${suggested.listings} listings), so Sayso put ${money(suggested.median)}. Keep it or set your own before publishing.`
      : `What does ${what} cost? Set a price before publishing.`;
  });
}
