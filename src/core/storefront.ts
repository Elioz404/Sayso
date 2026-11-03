// How a shop reads to people on its pages: stock in plain words, and what to ask an assistant for.
// Framework-free so the shop page, the product page and tests share it.

import { available, type Catalog, type Product, type Variant } from './catalog.ts';

export type StockTone = 'ok' | 'low' | 'out' | 'made';

export function stockNote(v: Variant): { text: string; tone: StockTone } {
  if (v.madeToOrderDays !== undefined) return { text: `Made to order, about ${v.madeToOrderDays} days`, tone: 'made' };
  if (available(v) === 0) return { text: 'Sold out', tone: 'out' };
  if (v.inventory === 1) return { text: 'Last one', tone: 'low' };
  return { text: `${v.inventory} in stock`, tone: 'ok' };
}

/**
 * What to say to an assistant, built from something the shop can sell right now: in `product` when
 * given, otherwise anywhere in the shop. Prefers a variant with more than one left, so the example works.
 */
export function assistantPrompt({ shop, products }: Catalog, product?: Product): string {
  const pool = (product ? [product] : products).flatMap((p) => p.variants.map((v) => ({ p, v })));
  const pick = pool.find(({ v }) => v.madeToOrderDays === undefined && v.inventory > 1) ?? pool.find(({ v }) => available(v) > 0);
  if (!pick) return product ? `Ask ${shop.name} on Sayso when the ${product.name} is back.` : `Show me what ${shop.name} sells on Sayso.`;
  const named = pick.v.title && pick.v.title !== 'Default' ? `${pick.v.title} ${pick.p.name}` : pick.p.name;
  return `Buy a ${named} from ${shop.name} on Sayso and ship it to me.`;
}
