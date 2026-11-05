// How a shop reads to people on its pages: stock in plain words, and what to ask an assistant for.
// Framework-free so the shop page, the product page and tests share it.

import { available, type Catalog, type Product, type Variant, variantTitle } from './catalog.ts';
import type { Links } from './links.ts';

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
  const named = variantTitle(pick.v.title) ? `${pick.v.title} ${pick.p.name}` : pick.p.name;
  return `Buy a ${named} from ${shop.name} on Sayso and ship it to me.`;
}

/** Where "buy with AI" goes: the site's shopping assistant, with the request already written. */
export function assistantLink(request: string): string {
  return `/assistant?ask=${encodeURIComponent(request)}`;
}

/** One shop in the directory: its picture, what it sells and for how much. */
export function shopCard({ shop, products }: Catalog) {
  const prices = products.flatMap((p) => p.variants.map((v) => v.price));
  const kinds = [...new Set(products.map((p) => p.category.split('/').at(-1) ?? p.category))].filter(Boolean);
  return {
    slug: shop.slug,
    name: shop.name,
    demo: Boolean(shop.demo),
    country: shop.country,
    currency: shop.currency,
    kinds: kinds.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).slice(0, 4),
    products: products.length,
    from: prices.length ? Math.min(...prices) : undefined,
    to: prices.length ? Math.max(...prices) : undefined,
    picture: shop.cover?.url ?? products.find((p) => p.imageUrl)?.imageUrl,
  };
}

/** Made-to-order pieces have no stock to run out of; a cart still shouldn't take more than this at once. */
export const MADE_TO_ORDER_CAP = 10;

/** What "Add to cart" puts in the shopper's cart for one variant (the shop prices it again at checkout). */
export function cartLine({ shop }: Catalog, product: Product, variant: Variant, links: Pick<Links, 'asset'>) {
  return {
    variantId: variant.id,
    productId: product.id,
    name: product.name,
    variant: variantTitle(variant.title),
    price: variant.price,
    currency: shop.currency,
    ...(product.imageUrl ? { image: links.asset(product.imageUrl) } : {}),
    max: Math.min(available(variant), MADE_TO_ORDER_CAP),
  };
}
