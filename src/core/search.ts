// Product search over one shop's catalog, for the words shoppers and their assistants actually use.
// Filler words ("a gift for my sister") are dropped, plurals fold, and the trade's own synonyms count
// (pottery finds ceramics and stoneware, handmade finds hand-thrown). Products with every remaining word
// come first; if none has them all, the closest ones come back instead of nothing. Variants over the price
// cap (or out of stock, if asked) are left out. Results are written for agents to read.

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

/** Words that say nothing about the product. */
const FILLER = new Set(
  'a an the for to of and or with my me i im some something anything any under below less than around about gift gifts present please want need looking look buy find shop get show have has is are that this one ones who loves like likes her his their sister brother mom mum dad friend'.split(' '),
);

/** Each group is one idea in a maker's catalog; any member finds the others. Members are already stems. */
const SYNONYMS: string[][] = [
  ['pottery', 'ceramic', 'stoneware', 'clay', 'porcelain', 'earthenware', 'potter'],
  ['handmade', 'hand-made', 'hand-thrown', 'handthrown', 'handcrafted', 'hand-crafted', 'artisan', 'wheel-thrown', 'handbuilt', 'hand-built'],
  ['mug', 'cup', 'tumbler'],
  ['bowl', 'dish'],
  ['vase', 'planter'],
  ['custom', 'commission', 'made-to-order', 'bespoke', 'personalized', 'personalised'],
];
const GROUP = new Map(SYNONYMS.flatMap((group) => group.map((w) => [w, group] as const)));

/** A word with its plural folded: "mugs" and "dishes" become "mug" and "dish". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function parseWords(text: unknown): string[] {
  return [...new Set(String(text ?? '').toLowerCase().split(/[^a-z0-9$-]+/).filter((w) => w && !FILLER.has(w) && !/^\$?\d/.test(w)).map(stem))];
}

/** Whether a product's text (as a set of stems, plus the raw text for hyphenated words) has this word or a synonym. */
function has(tokens: Set<string>, text: string, word: string): boolean {
  return (GROUP.get(word) ?? [word]).some((w) => (w.includes('-') ? text.includes(w) : tokens.has(w)));
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
  const scored = catalog.products.map((p) => {
    const text = [catalog.shop.name, p.name, p.description, p.category, ...p.tags, ...p.variants.map((v) => v.title)].join(' ').toLowerCase();
    const tokens = new Set(text.split(/[^a-z0-9-]+/).flatMap((t) => [t, ...t.split('-')]).filter(Boolean).map(stem));
    return { p, score: query.words.filter((w) => has(tokens, text, w)).length };
  });
  // Every word if any product has them all; otherwise the closest (at least half the words), best first.
  const all = scored.filter((s) => s.score === query.words.length);
  const pick = all.length > 0 ? all : scored.filter((s) => s.score > 0 && s.score >= query.words.length / 2).sort((a, b) => b.score - a.score);
  return pick.flatMap(({ p }) => {
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
