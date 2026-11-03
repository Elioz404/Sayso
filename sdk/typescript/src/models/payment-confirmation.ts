import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { paymentStatusSchema, type PaymentStatus } from "./payment-status.js";

export type PaymentConfirmation = {
  merchantOrderNumber: string;
  paypalOrderId?: string;
  /** CAPTURED means charged; otherwise authorized and waiting for the shop owner. */
  paymentStatus: PaymentStatus;
  /** The shop's say-so record for the capture */
  guardRecordId?: string;
};

export const paymentConfirmationSchema: Schema<PaymentConfirmation> = s.object<PaymentConfirmation>({
  merchantOrderNumber: s.string(),
  paypalOrderId: s.optional(s.string()),
  paymentStatus: paymentStatusSchema,
  guardRecordId: s.optional(s.string()),
  _keysMap: {
    merchantOrderNumber: "merchant_order_number",
    paypalOrderId: "paypal_order_id",
    paymentStatus: "payment_status",
    guardRecordId: "guard_record_id",
  },
});
