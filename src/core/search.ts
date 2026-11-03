// Product search over one shop's catalog: every word must appear somewhere in the product, and variants
// over the price cap (or out of stock, if asked) are left out. Results are written for agents to read.

import type { Catalog } from './catalog.ts';
import { HttpError } from './errors.ts';
import { formatMoney, parseAmount } from './money.ts';

export interface ProductQuery {
  /** Lower-case words; empty matches everything. */
  words: string[];
  /** Highest price per item, in minor units of the shop currency. */
  maxPrice?: number;
  inStockOnly?: boolean;
}

export function parseWords(text: unknown): string[] {
  return String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Search input as people and agents send it, read in the shop's currency. */
export function productQuery(catalog: Catalog, input: { query?: string; max_price?: string; in_stock_only?: boolean }): ProductQuery {
  const maxPrice = input.max_price === undefined ? undefined : parseAmount(input.max_price, catalog.shop.currency);
  if (input.max_price !== undefined && maxPrice === undefined) throw new HttpError(400, 'max_price must look like 25.00');
  return { words: parseWords(input.query), maxPrice, inStockOnly: input.in_stock_only };
}

/** One line about a shop for a list of shops. */
export function shopSummary({ shop, products }: Catalog) {
  return {
    shop: shop.slug,
    name: shop.name,
    ships_from: shop.country,
    currency: shop.currency,
    sells: [...new Set(products.map((p) => p.category))].slice(0, 6),
    products: products.length,
  };
}

export function searchCatalog(catalog: Catalog, query: ProductQuery) {
  const { currency } = catalog.shop;
  return catalog.products.flatMap((p) => {
    const text = [p.name, p.description, p.category, ...p.tags, ...p.variants.map((v) => v.title)].join(' ').toLowerCase();
    if (!query.words.every((w) => text.includes(w))) return [];
    const variants = p.variants.filter(
      (v) => v.price <= (query.maxPrice ?? Infinity) && (!query.inStockOnly || v.madeToOrderDays !== undefined || v.inventory > 0),
    );
    if (variants.length === 0) return [];
    return [
      {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        variants: variants.map((v) => ({
          variant_id: v.id,
          title: v.title,
          price: formatMoney(v.price, currency),
          in_stock: v.madeToOrderDays !== undefined ? `made to order, ships in ~${v.madeToOrderDays} days` : v.inventory,
        })),
      },
    ];
  });
}
