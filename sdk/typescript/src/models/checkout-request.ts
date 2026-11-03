import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { cartItemSchema, type CartItem } from "./cart-item.js";
import { paymentMethod1Schema, type PaymentMethod1 } from "./payment-method1.js";

export type CheckoutRequest = {
  /** Ignored; the stored cart is what gets paid. */
  items?: CartItem[];
  paymentMethod: PaymentMethod1;
};

export const checkoutRequestSchema: Schema<CheckoutRequest> = s.object<CheckoutRequest>({
  items: s.optional(s.array(s.lazy(() => cartItemSchema))),
  paymentMethod: paymentMethod1Schema,
  _keysMap: {
    paymentMethod: "payment_method",
  },
});
