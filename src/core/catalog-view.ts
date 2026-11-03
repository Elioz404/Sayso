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
}

export function variantRows(catalog: Catalog): VariantRow[] {
  return catalog.products.flatMap((p) => p.variants.map((v) => toRow(catalog, p.name, p.variants.length, v.id)!));
}

export function variantRow(catalog: Catalog, variantId: string): VariantRow | undefined {
  const found = findVariant(catalog, variantId);
  return found && toRow(catalog, found.product.name, found.product.variants.length, variantId);
}

function toRow(catalog: Catalog, product: string, siblings: number, variantId: string): VariantRow | undefined {
  const variant = findVariant(catalog, variantId)?.variant;
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
  };
}
