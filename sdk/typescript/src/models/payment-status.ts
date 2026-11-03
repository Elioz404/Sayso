import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

/** CAPTURED means charged; otherwise authorized and waiting for the shop owner. */
export const PaymentStatus = {
  Captured: "CAPTURED",
  AuthorizedPendingMerchantReview: "AUTHORIZED_PENDING_MERCHANT_REVIEW",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus] | (string & {});

export const paymentStatusSchema: EnumSchema<PaymentStatus> = s.enumOf<PaymentStatus>(PaymentStatus);
