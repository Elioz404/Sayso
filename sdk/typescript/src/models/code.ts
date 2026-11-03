import * as s from "../core/validation/index.js";
import type { EnumSchema } from "../core/validation/schema.js";

export const Code = {
  InventoryIssue: "INVENTORY_ISSUE",
  PricingError: "PRICING_ERROR",
  ShippingError: "SHIPPING_ERROR",
  PaymentError: "PAYMENT_ERROR",
  DataError: "DATA_ERROR",
  BusinessRuleError: "BUSINESS_RULE_ERROR",
} as const;
export type Code = (typeof Code)[keyof typeof Code] | (string & {});

export const codeSchema: EnumSchema<Code> = s.enumOf<Code>(Code);
