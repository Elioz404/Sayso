import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { productVariantSchema, type ProductVariant } from "./product-variant.js";

export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  variants: ProductVariant[];
};

export const productSchema: Schema<Product> = s.object<Product>({
  id: s.string(),
  name: s.string(),
  description: s.string(),
  category: s.string(),
  variants: s.array(s.lazy(() => productVariantSchema)),
});
