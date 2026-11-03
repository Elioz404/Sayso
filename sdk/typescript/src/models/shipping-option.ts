import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { moneySchema, type Money } from "./money.js";

export type ShippingOption = {
  id: string;
  name: string;
  /** An amount as PayPal writes it. */
  price: Money;
  isSelected: boolean;
  description?: string;
  estimatedDelivery?: string;
};

export const shippingOptionSchema: Schema<ShippingOption> = s.object<ShippingOption>({
  id: s.string(),
  name: s.string(),
  price: moneySchema,
  isSelected: s.boolean(),
  description: s.optional(s.string()),
  estimatedDelivery: s.optional(s.dateOnly()),
  _keysMap: {
    isSelected: "is_selected",
    estimatedDelivery: "estimated_delivery",
  },
});
