// Types for PayPal's Agentic Commerce merchant-cart API (v1).
// Source: https://developer.paypal.com/api/agentic-commerce/v1/schema.yaml
// Only the fields Sayso reads or writes are modelled; names and enums match the spec verbatim.

import type { Money } from '../money.ts';

export type CartStatus = 'CREATED' | 'INCOMPLETE' | 'READY' | 'COMPLETED';
export type ValidationStatus = 'VALID' | 'INVALID' | 'REQUIRES_ADDITIONAL_INFORMATION';

export type IssueCode =
  | 'INVENTORY_ISSUE'
  | 'PRICING_ERROR'
  | 'SHIPPING_ERROR'
  | 'PAYMENT_ERROR'
  | 'DATA_ERROR'
  | 'BUSINESS_RULE_ERROR';

export type IssueType = 'MISSING_FIELD' | 'INVALID_DATA' | 'BUSINESS_RULE';

export interface ResolutionOption {
  action: string;
  label: string;
  metadata?: {
    priority?: number;
    auto_applicable?: boolean;
    cost_impact?: Money;
    estimated_time?: string;
    [key: string]: unknown;
  };
}

export interface ValidationIssue {
  code: IssueCode;
  type: IssueType;
  message: string;
  user_message?: string;
  variant_id?: string;
  field?: string;
  context?: Record<string, unknown>;
  resolution_options?: ResolutionOption[];
}

export interface CartItem {
  quantity: number;
  variant_id?: string;
  parent_id?: string;
  name?: string;
  description?: string;
  item_url?: string;
  price?: Money;
  selected_attributes?: { name: string; value: string }[];
}

export interface Address {
  address_line_1?: string;
  address_line_2?: string;
  admin_area_2?: string; // city
  admin_area_1?: string; // state / province
  postal_code?: string;
  country_code: string;
}

export interface Customer {
  name?: { given_name?: string; surname?: string };
  email_address?: string;
  phone?: string;
}

export interface ShippingOption {
  id: string;
  name: string;
  price: Money;
  is_selected: boolean;
  description?: string;
  estimated_delivery?: string; // YYYY-MM-DD
}

export interface PaymentMethod {
  type: 'paypal';
  token?: string;
  payer_id?: string;
  approval_url?: string;
}

export interface CartTotals {
  total: Money;
  subtotal?: Money;
  discount?: Money;
  shipping?: Money;
  tax?: Money;
}

export interface PayPalCart {
  id?: string;
  status?: CartStatus;
  validation_status?: ValidationStatus;
  validation_issues?: ValidationIssue[];
  totals?: CartTotals;
  available_shipping_options?: ShippingOption[];
  items: CartItem[];
  customer?: Customer;
  shipping_address?: Address;
  billing_address?: Address;
  payment_method?: PaymentMethod;
}

/** 200 body of POST /merchant-cart/{cartId}/checkout. */
export interface CheckoutResult extends PayPalCart {
  payment_confirmation?: { merchant_order_number: string; [key: string]: unknown };
}
