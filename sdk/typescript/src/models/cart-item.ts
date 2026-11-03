import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { moneySchema, type Money } from "./money.js";
import { selectedAttributeSchema, type SelectedAttribute } from "./selected-attribute.js";

export type CartItem = {
  variantId?: string;
  quantity: number;
  parentId?: string;
  name?: string;
  description?: string;
  /** An amount as PayPal writes it. */
  price?: Money;
  selectedAttributes?: SelectedAttribute[];
};

export const cartItemSchema: Schema<CartItem> = s.object<CartItem>({
  variantId: s.optional(s.string()),
  quantity: s.int(),
  parentId: s.optional(s.string()),
  name: s.optional(s.string()),
  description: s.optional(s.string()),
  price: s.optional(s.lazy(() => moneySchema)),
  selectedAttributes: s.optional(s.array(s.lazy(() => selectedAttributeSchema))),
  _keysMap: {
    variantId: "variant_id",
    parentId: "parent_id",
    selectedAttributes: "selected_attributes",
  },
});
