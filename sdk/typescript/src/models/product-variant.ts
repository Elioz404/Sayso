import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { inStockSchema, type InStock } from "./unions/in-stock.js";

export type ProductVariant = {
  variantId: string;
  title: string;
  /** Formatted price */
  price: string;
  /** Units on hand, or a made-to-order lead time */
  inStock: InStock;
};

export const productVariantSchema: Schema<ProductVariant> = s.object<ProductVariant>({
  variantId: s.string(),
  title: s.string(),
  price: s.string(),
  inStock: inStockSchema,
  _keysMap: {
    variantId: "variant_id",
    inStock: "in_stock",
  },
});
