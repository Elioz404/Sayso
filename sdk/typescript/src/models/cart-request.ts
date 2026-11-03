import * as s from "../core/validation/index.js";
import type { Schema } from "../core/validation/schema.js";
import { addressSchema, type Address } from "./address.js";
import { cartItemSchema, type CartItem } from "./cart-item.js";
import { customerSchema, type Customer } from "./customer.js";
import { shippingOptionSchema, type ShippingOption } from "./shipping-option.js";

export type CartRequest = {
  items: CartItem[];
  shippingAddress?: Address;
  billingAddress?: Address;
  customer?: Customer;
  /** Mark one `is_selected` to pick it; the rest is ignored. */
  availableShippingOptions?: ShippingOption[];
};

export const cartRequestSchema: Schema<CartRequest> = s.object<CartRequest>({
  items: s.array(s.lazy(() => cartItemSchema)),
  shippingAddress: s.optional(s.lazy(() => addressSchema)),
  billingAddress: s.optional(s.lazy(() => addressSchema)),
  customer: s.optional(s.lazy(() => customerSchema)),
  availableShippingOptions: s.optional(s.array(s.lazy(() => shippingOptionSchema))),
  _keysMap: {
    shippingAddress: "shipping_address",
    billingAddress: "billing_address",
    availableShippingOptions: "available_shipping_options",
  },
});
