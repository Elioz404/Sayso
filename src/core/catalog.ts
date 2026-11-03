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
}

export interface Product {
  id: string;
  shopId: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  imageUrl?: string;
  /** PayPal Catalog product id once synced (POST /v1/catalogs/products). */
  paypalProductId?: string;
  variants: Variant[];
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
  shipping: ShippingRule[];
  /** Tax in basis points by destination country (or "US-CA" style region). Missing means 0. */
  taxBps: Record<string, number>;
  returnPolicy: { days: number; buyerPaysReturn: boolean };
  /** Drafts come out of onboarding; agents can only shop once the owner publishes. Missing = live. */
  status?: 'draft' | 'live';
  createdAt?: string;
}

export interface Catalog {
  shop: Shop;
  products: Product[];
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
