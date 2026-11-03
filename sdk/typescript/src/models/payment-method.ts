import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";

export type PaymentMethod = {
  /** @default "paypal" */
  type?: "paypal";
  /** The PayPal order id */
  token?: string;
  payerId?: string;
  /** Where the buyer approves the payment in PayPal */
  approvalUrl?: string;
};

export const paymentMethodSchema: Schema<PaymentMethod> = s.object<PaymentMethod>({
  type: s.defaulted(s.literal("paypal"), "paypal"),
  token: s.optional(s.string()),
  payerId: s.optional(s.string()),
  approvalUrl: s.optional(s.string()),
  _keysMap: {
    payerId: "payer_id",
    approvalUrl: "approval_url",
  },
});
