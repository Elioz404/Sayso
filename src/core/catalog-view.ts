// The catalog as rows, one per variant: what the owner's grid shows and edits. Framework-free so the
// page, the API route and tests share it.

import { findVariant, type Catalog } from './catalog.ts';

export interface VariantRow {
  id: string;
  product: string;
  /** The variant's own name, empty when the product has a single default variant. */
  title: string;
  currency: string;
  /** Minor units. */
  price: number;
  /** Units on hand; null for made-to-order variants, which have no stock limit. */
  stock: number | null;
  madeToOrderDays?: number;
  /** The price is a draft's suggestion the owner hasn't confirmed; the shop can't be published yet. */
  toConfirm: boolean;
  /** The product's photo (a path on this site or a full URL). */
  image?: string;
  /** Registered in PayPal's catalog (Catalog Products API). */
  inPayPal: boolean;
  /** Units sold in the last 14 days, when the page knows (the owner's catalog view adds it). */
  sold?: number;
}

export function variantRows(catalog: Catalog): VariantRow[] {
  return catalog.products.flatMap((p) => p.variants.map((v) => toRow(catalog, p.name, p.variants.length, v.id)!));
}

export function variantRow(catalog: Catalog, variantId: string): VariantRow | undefined {
  const found = findVariant(catalog, variantId);
  return found && toRow(catalog, found.product.name, found.product.variants.length, variantId);
}

function toRow(catalog: Catalog, product: string, siblings: number, variantId: string): VariantRow | undefined {
  const found = findVariant(catalog, variantId);
  const variant = found?.variant;
  if (!variant) return undefined;
  return {
    id: variant.id,
    product,
    title: siblings > 1 || variant.title !== 'Default' ? variant.title : '',
    currency: catalog.shop.currency,
    price: variant.price,
    stock: variant.madeToOrderDays === undefined ? variant.inventory : null,
    madeToOrderDays: variant.madeToOrderDays,
    toConfirm: Boolean(variant.priceToConfirm),
    ...(found.product.imageUrl ? { image: found.product.imageUrl } : {}),
    inPayPal: Boolean(found.product.paypalProductId),
  };
}

/** Units of each variant sold since `since`, from the shop's orders (cancelled ones don't count). */
export function soldSince(orders: { status: string; number?: string; createdAt: string; items: { variant_id?: string; quantity: number }[] }[], since: Date): Map<string, number> {
  const sold = new Map<string, number>();
  for (const o of orders) {
    if (!o.number || o.status === 'released' || Date.parse(o.createdAt) < since.getTime()) continue;
    for (const i of o.items) if (i.variant_id) sold.set(i.variant_id, (sold.get(i.variant_id) ?? 0) + i.quantity);
  }
  return sold;
}
