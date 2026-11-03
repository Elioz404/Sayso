import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type PaymentMethod1 = {
  /** @default "paypal" */
  type?: "paypal";
  /** The PayPal order id the buyer approved */
  token: string;
  /** PayerID from PayPal's return URL */
  payerId?: string;
};

export const paymentMethod1Schema: Schema<PaymentMethod1> = s.object<PaymentMethod1>({
  type: s.defaulted(s.literal("paypal"), "paypal"),
  token: s.string(),
  payerId: s.optional(s.string()),
  _keysMap: {
    payerId: "payer_id",
  },
});
