import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { addressSchema, type Address } from "./address.js";
import { cartItemSchema, type CartItem } from "./cart-item.js";
import { cartTotalsSchema, type CartTotals } from "./cart-totals.js";
import { customerSchema, type Customer } from "./customer.js";
import { paymentMethodSchema, type PaymentMethod } from "./payment-method.js";
import { shippingOptionSchema, type ShippingOption } from "./shipping-option.js";
import { statusSchema, type Status } from "./status.js";
import { validationIssueSchema, type ValidationIssue } from "./validation-issue.js";
import { validationStatusSchema, type ValidationStatus } from "./validation-status.js";

export type CartError = {
  id?: string;
  status?: Status;
  validationStatus?: ValidationStatus;
  validationIssues?: ValidationIssue[];
  items: CartItem[];
  totals?: CartTotals;
  availableShippingOptions?: ShippingOption[];
  customer?: Customer;
  shippingAddress?: Address;
  billingAddress?: Address;
  paymentMethod?: PaymentMethod;
};

export const cartErrorSchema: Schema<CartError> = s.object<CartError>({
  id: s.optional(s.string()),
  status: s.optional(s.lazy(() => statusSchema)),
  validationStatus: s.optional(s.lazy(() => validationStatusSchema)),
  validationIssues: s.optional(s.array(s.lazy(() => validationIssueSchema))),
  items: s.array(s.lazy(() => cartItemSchema)),
  totals: s.optional(s.lazy(() => cartTotalsSchema)),
  availableShippingOptions: s.optional(s.array(s.lazy(() => shippingOptionSchema))),
  customer: s.optional(s.lazy(() => customerSchema)),
  shippingAddress: s.optional(s.lazy(() => addressSchema)),
  billingAddress: s.optional(s.lazy(() => addressSchema)),
  paymentMethod: s.optional(s.lazy(() => paymentMethodSchema)),
  _keysMap: {
    validationStatus: "validation_status",
    validationIssues: "validation_issues",
    availableShippingOptions: "available_shipping_options",
    shippingAddress: "shipping_address",
    billingAddress: "billing_address",
    paymentMethod: "payment_method",
  },
});
