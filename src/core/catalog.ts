// Sayso's own model of a small seller's shop. The onboarding agent produces this from photos, a
// price list or a description; the cart engine and the MCP storefront read it.

export interface Variant {
  id: string;
  productId: string;
  /** e.g. "Speckled white / 12 oz" */
  title: string;
  /** Price in integer minor units of the shop currency. */
  price: number;
  inventory: number;
  attributes: Record<string, string>;
  /** Made-to-order items can be sold beyond stock, with a lead time instead. */
  madeToOrderDays?: number;
  /**
   * The price isn't the owner's yet: Sayso drafted this variant without one, and `price` is what the
   * market suggests (or 0 when it couldn't tell). The shop can't be published until the owner sets or
   * keeps a price, which clears this.
   */
  priceToConfirm?: { suggested?: PriceSuggestion };
}

/** What similar items sell for elsewhere, from a market search. Minor units of the shop currency. */
export interface PriceSuggestion {
  low: number;
  median: number;
  high: number;
  /** How many comparable listings the range is built from. */
  listings: number;
}

/** Variants whose price the owner still has to confirm, by product name and variant title. */
export function pricesToConfirm(catalog: Catalog): { product: Product; variant: Variant }[] {
  return catalog.products.flatMap((product) => product.variants.filter((v) => v.priceToConfirm).map((variant) => ({ product, variant })));
}

export interface Product {
  id: string;
  shopId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  /** A full URL, or a path on this site such as /photos/mugs.webp. */
  imageUrl?: string;
  /** PayPal Catalog product id once synced (POST /v1/catalogs/products). */
  paypalProductId?: string;
  variants: Variant[];
}

export interface Photo {
  /** A full URL, or a path on this site. */
  url: string;
  /** What the photo shows, for people who can't see it. */
  alt: string;
}

export interface ShippingRule {
  id: string;
  name: string;
  /** ISO-3166 alpha-2 codes, or ["*"] for worldwide. */
  countries: string[];
  price: number;
  /** Free above this subtotal (minor units), if set. */
  freeAbove?: number;
  minDays: number;
  maxDays: number;
}

export interface Shop {
  id: string;
  slug: string;
  name: string;
  /** ISO-4217, e.g. "USD". The cart is always priced in this currency. */
  currency: string;
  /** Country the seller ships from (ISO-3166 alpha-2). */
  country: string;
  /** The owner's IANA time zone ("America/Los_Angeles"): where the shop's days start. Missing: UTC. */
  timeZone?: string;
  shipping: ShippingRule[];
  /** Tax in basis points by destination country (or "US-CA" style region). Missing means 0. */
  taxBps: Record<string, number>;
  returnPolicy: { days: number; buyerPaysReturn: boolean };
  /** A picture of the shop or its workshop, at the top of its page. */
  cover?: Photo;
  /** A made-up shop for trying Sayso (the demo shop and judges' tour copies): its page says so. */
  demo?: boolean;
  /** Drafts come out of onboarding; agents can only shop once the owner publishes. Missing = live. */
  status?: 'draft' | 'live';
  /** private: reachable by its own link and its owner, never in shop lists (a judge's tour copy). Missing = public. */
  visibility?: 'public' | 'private';
  /** When a temporary shop (a tour copy) is cleaned up. */
  expiresAt?: string;
  /** The seller account that owns it (signed in with PayPal). Missing: owned through an owner secret only. */
  sellerId?: string;
  /**
   * The owner's own PayPal account, connected through PayPal's partner onboarding: sales are paid
   * straight into it, and refunds are made from it on the owner's behalf. Missing: paid to Sayso's account.
   */
  payout?: Payout;
  createdAt?: string;
}

export interface Payout {
  /** PayPal merchant id of the owner's account (PayPal's answer, never the browser's). */
  merchantId: string;
  connectedAt: string;
}

export interface Catalog {
  shop: Shop;
  products: Product[];
  /**
   * Products drafted from the owner's photos after the shop opened. Buyers never see these: a draft
   * joins `products` only when the owner confirms its price and puts it on sale.
   */
  drafts?: Product[];
  /** Ids of products (and their options) taken off sale. Old orders still point at them, so none is given out again. */
  retired?: string[];
}

export function findVariant(catalog: Catalog, variantId: string): { product: Product; variant: Variant } | undefined {
  for (const product of catalog.products) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) return { product, variant };
  }
  return undefined;
}

export function isLive(catalog: Catalog): boolean {
  return (catalog.shop.status ?? 'live') === 'live';
}

/** Live and listed: what shop lists and cross-shop search show. */
export function isListed(catalog: Catalog): boolean {
  return isLive(catalog) && (catalog.shop.visibility ?? 'public') === 'public';
}

/** URL-safe slug from a shop or product name: "Maya's Ceramics!" -> "mayas-ceramics". */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'shop'
  );
}

/** Units that can be promised right now: stock, or unlimited for made-to-order variants. */
export function available(variant: Variant): number {
  return variant.madeToOrderDays !== undefined ? Number.POSITIVE_INFINITY : Math.max(0, variant.inventory);
}

/** Units of one variant taken from (or given back to) stock. */
export interface StockLine {
  variantId: string;
  quantity: number;
}

/** The same variant on several cart lines counts once, with the quantities added up. */
export function stockLines(items: readonly { variant_id?: string; quantity: number }[]): StockLine[] {
  const totals = new Map<string, number>();
  for (const item of items) if (item.variant_id) totals.set(item.variant_id, (totals.get(item.variant_id) ?? 0) + item.quantity);
  return [...totals].map(([variantId, quantity]) => ({ variantId, quantity }));
}

/**
 * Take `lines` out of stock, all or nothing: false (and the catalog untouched) if any variant is short
 * or gone. Made-to-order variants are never short. Mutates `catalog`; stores call it inside their lock.
 */
export function takeStock(catalog: Catalog, lines: readonly StockLine[]): boolean {
  const found = lines.map((l) => ({ line: l, variant: findVariant(catalog, l.variantId)?.variant }));
  if (found.some(({ line, variant }) => !variant || available(variant) < line.quantity)) return false;
  for (const { line, variant } of found) if (variant!.madeToOrderDays === undefined) variant!.inventory -= line.quantity;
  return true;
}

/** Put `lines` back in stock, e.g. when a held order is released. Variants removed since are skipped. */
export function returnStock(catalog: Catalog, lines: readonly StockLine[]): void {
  for (const line of lines) {
    const variant = findVariant(catalog, line.variantId)?.variant;
    if (variant && variant.madeToOrderDays === undefined) variant.inventory += line.quantity;
  }
}
