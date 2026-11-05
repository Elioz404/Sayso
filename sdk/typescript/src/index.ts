export { SaysoShopsApiClient } from "./client.js";
export type { ClientOptions } from "./client-options.js";

export { ServerEnvironment } from "./servers.js";

export { Shops } from "./resources/shops.js";
export { MerchantCart } from "./resources/merchant-cart.js";
export { Service } from "./resources/service.js";

export { addressSchema, type Address } from "./models/address.js";
export { cartSchema, type Cart } from "./models/cart.js";
export { cartItemSchema, type CartItem } from "./models/cart-item.js";
export { cartRequestSchema, type CartRequest } from "./models/cart-request.js";
export { cartTotalsSchema, type CartTotals } from "./models/cart-totals.js";
export { cartErrorSchema, type CartError } from "./models/cart-error.js";
export { checkoutRequestSchema, type CheckoutRequest } from "./models/checkout-request.js";
export { checkoutResultSchema, type CheckoutResult } from "./models/checkout-result.js";
export { Code, codeSchema } from "./models/code.js";
export { customerSchema, type Customer } from "./models/customer.js";
export { errorSchema, type Error } from "./models/error.js";
export { errorErrorSchema, type ErrorError } from "./models/error-error.js";
export { healthSchema, type Health } from "./models/health.js";
export { healthErrorSchema, type HealthError } from "./models/health-error.js";
export { inStockSchema, type InStock } from "./models/unions/in-stock.js";
export { metadataSchema, type Metadata } from "./models/metadata.js";
export { moneySchema, type Money } from "./models/money.js";
export { nameSchema, type Name } from "./models/name.js";
export { paymentConfirmationSchema, type PaymentConfirmation } from "./models/payment-confirmation.js";
export { paymentMethodSchema, type PaymentMethod } from "./models/payment-method.js";
export { paymentMethod1Schema, type PaymentMethod1 } from "./models/payment-method1.js";
export { PaymentStatus, paymentStatusSchema } from "./models/payment-status.js";
export { productSchema, type Product } from "./models/product.js";
export { productVariantSchema, type ProductVariant } from "./models/product-variant.js";
export { resolutionOptionSchema, type ResolutionOption } from "./models/resolution-option.js";
export { selectedAttributeSchema, type SelectedAttribute } from "./models/selected-attribute.js";
export { shippingMethodSchema, type ShippingMethod } from "./models/shipping-method.js";
export { shippingOptionSchema, type ShippingOption } from "./models/shipping-option.js";
export { shopSchema, type Shop } from "./models/shop.js";
export { shopOfferSchema, type ShopOffer } from "./models/shop-offer.js";
export { shopSummarySchema, type ShopSummary } from "./models/shop-summary.js";
export { Status, statusSchema } from "./models/status.js";
export { Status1, status1Schema } from "./models/status1.js";
export { Storage, storageSchema } from "./models/storage.js";
export { Type, typeSchema } from "./models/type.js";
export { validationIssueSchema, type ValidationIssue } from "./models/validation-issue.js";
export { ValidationStatus, validationStatusSchema } from "./models/validation-status.js";

export {
  CoreError as SaysoShopsApiError,
  ResponseError,
  DecodeError,
  EncodeError,
  ConnectionError,
  TimeoutError,
  AuthError,
  PaginationError,
  ConfigurationError,
} from "./core/errors.js";
export { ApiError } from "./core/api-error.js";
export { SchemaError } from "./core/validation/schema-error.js";
export {
  defaultLoggingOptions,
  type LoggingOptions,
  type RequestLoggingOptions,
  type Logger,
  type LogDetails,
  type HttpRequestDetails,
  type RequestHeadersDetails,
  type RequestBodyDetails,
  type HttpResponseDetails,
  type ResponseHeadersDetails,
  type HttpRetryingDetails,
  type HttpFailedDetails,
  type LogLevel,
} from "./core/logging.js";
export type { ApiPromise, ApiResult } from "./core/api-promise.js";
export type { Pageable, PageableApiResult } from "./core/pagination/pageable.js";
export type { HttpMethod, RequestOptions } from "./core/api-request.js";
export type { RetryOptions, RequestRetryOptions, RetryAttempt, RetryReason } from "./core/retry.js";
export type { BinaryContent, BinaryData, BinaryErrorContent, FileData, FileInput } from "./core/binary.js";
export type { ErrorKind } from "./core/errors.js";
export type { Declared, Undeclared } from "./core/api-error.js";
export type { Schema, EnumSchema, Encoded } from "./core/validation/schema.js";
