import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type ShippingMethod = {
  name: string;
  /** Comma-separated country codes */
  to: string;
  price: string;
  days: string;
};

export const shippingMethodSchema: Schema<ShippingMethod> = s.object<ShippingMethod>({
  name: s.string(),
  to: s.string(),
  price: s.string(),
  days: s.string(),
});
