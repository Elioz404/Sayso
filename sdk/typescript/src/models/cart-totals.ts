import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { moneySchema, type Money } from "./money.js";

export type CartTotals = {
  /** An amount as PayPal writes it. */
  subtotal?: Money;
  /** An amount as PayPal writes it. */
  shipping?: Money;
  /** An amount as PayPal writes it. */
  tax?: Money;
  /** An amount as PayPal writes it. */
  discount?: Money;
  /** An amount as PayPal writes it. */
  total: Money;
};

export const cartTotalsSchema: Schema<CartTotals> = s.object<CartTotals>({
  subtotal: s.optional(s.lazy(() => moneySchema)),
  shipping: s.optional(s.lazy(() => moneySchema)),
  tax: s.optional(s.lazy(() => moneySchema)),
  discount: s.optional(s.lazy(() => moneySchema)),
  total: moneySchema,
});
