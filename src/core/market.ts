// What similar products sell for elsewhere, so a small seller can price with confidence. Listings come
// from a product-search source (Channel3 in production); this file only turns them into a reference
// range. The middle half of prices is used, so one odd listing (a set of six, a clearance item) can't
// skew it. Read-only: nothing here changes a price.

import type { Catalog, Product } from './catalog.ts';
import { findVariant } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import { formatMoney } from './money.ts';

export interface Listing {
  title: string;
  /** The store's domain, e.g. "allmodern.com". */
  store: string;
  /** Minor units of `currency`. */
  price: number;
  currency: string;
  url: string;
}

export interface ListingSource {
  /** Up to `limit` in-stock listings matching `query`. */
  search(query: string, limit: number): Promise<Listing[]>;
}

export interface PriceReference {
  query: string;
  currency: string;
  /** How many comparable listings the range is built from. */
  listings: number;
  low?: number;
  median?: number;
  high?: number;
  /** Where the shop's own price sits against the middle half of the market. */
  position?: 'below' | 'within' | 'above';
  summary: string;
  examples: { title: string; store: string; price: string; url: string }[];
}

/** Below this many listings there is no range worth showing. */
const MIN_LISTINGS = 3;
const SEARCH_LIMIT = 20;
/** Market prices move slowly; caching keeps every page view and agent question from spending a search. */
const CACHE_MS = 12 * 3_600_000;

export class MarketPrices {
  private readonly source: ListingSource;
  private readonly cache = new Map<string, { at: number; listings: Promise<Listing[]> }>();

  constructor(source: ListingSource) {
    this.source = source;
  }

  /** The reference for one variant of the shop, compared with its current price. */
  async forVariant(catalog: Catalog, variantId: string): Promise<PriceReference> {
    const found = findVariant(catalog, variantId);
    if (!found) throw notFound(`Variant ${variantId}`);
    const query = searchPhrase(found.product);
    const listings = await this.listings(query);
    return priceReference(query, listings, catalog.shop.currency, found.variant.price);
  }

  private listings(query: string): Promise<Listing[]> {
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.listings;
    const listings = this.source.search(query, SEARCH_LIMIT).catch((err: unknown) => {
      this.cache.delete(query); // don't remember a failure
      throw new HttpError(502, `Market prices are unavailable right now (${err instanceof Error ? err.message : 'error'})`);
    });
    this.cache.set(query, { at: Date.now(), listings });
    return listings;
  }
}

/** The product as a shopper would search for it: its name plus the tags that say what it is. */
export function searchPhrase(product: Product): string {
  const name = product.name.toLowerCase();
  const extra = product.tags.filter((t) => !name.includes(t.toLowerCase())).slice(0, 2);
  return [product.name, ...extra].join(' ');
}

/** Range, median and where `ownPrice` sits, from listings in the shop's currency. Exported for tests. */
export function priceReference(query: string, listings: Listing[], currency: string, ownPrice: number): PriceReference {
  const seen = new Set<string>();
  const comparable = listings.filter((l) => {
    const key = `${l.store}|${l.title.toLowerCase()}|${l.price}`;
    if (l.currency !== currency || l.price <= 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const money = (minor: number) => formatMoney(minor, currency);
  if (comparable.length < MIN_LISTINGS) {
    return { query, currency, listings: comparable.length, summary: `Not enough similar listings in ${currency} to compare "${query}".`, examples: [] };
  }

  const prices = comparable.map((l) => l.price).sort((a, b) => a - b);
  const low = percentile(prices, 0.25);
  const median = percentile(prices, 0.5);
  const high = percentile(prices, 0.75);
  const position = ownPrice < low ? 'below' : ownPrice > high ? 'above' : 'within';
  const where = { below: 'below the usual range', within: 'within the usual range', above: 'above the usual range' }[position];
  const examples = [...comparable]
    .sort((a, b) => Math.abs(a.price - median) - Math.abs(b.price - median))
    .slice(0, 3)
    .map((l) => ({ title: l.title, store: l.store, price: money(l.price), url: l.url }));

  return {
    query,
    currency,
    listings: comparable.length,
    low,
    median,
    high,
    position,
    summary: `Similar items sell for ${money(low)} to ${money(high)} (median ${money(median)}, ${comparable.length} listings). ${money(ownPrice)} is ${where}.`,
    examples,
  };
}

/** Nearest-rank percentile of sorted values, rounded to whole minor units. */
function percentile(sorted: number[], p: number): number {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower));
}
