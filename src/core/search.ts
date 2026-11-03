// Product search over one shop's catalog: every word must appear somewhere in the product, and variants
// over the price cap (or out of stock, if asked) are left out. Results are written for agents to read.

import type { Catalog } from './catalog.ts';
import { formatMoney } from './money.ts';

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
