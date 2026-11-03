import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import { uuid } from "../core/uuid.js";
import * as s from "../core/validation/index.js";
import { cartRequestSchema, type CartRequest } from "../models/cart-request.js";
import { cartSchema, type Cart } from "../models/cart.js";
import { checkoutRequestSchema, type CheckoutRequest } from "../models/checkout-request.js";
import { checkoutResultSchema, type CheckoutResult } from "../models/checkout-result.js";
import { errorSchema, type Error } from "../models/error.js";
import type { Servers } from "../servers.js";

/**
 * PayPal Agentic Commerce merchant-cart API (v1), one shop at a time.
 */
export class MerchantCart {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * Complete checkout
   *
   * @remarks
   * Call after the buyer approved in PayPal. Sayso re-checks stock and price, authorizes the
   * payment, takes the stock and submits the capture to the shop's Guard. Big orders may wait for
   * the owner: then `payment_status` is `AUTHORIZED_PENDING_MERCHANT_REVIEW` and the buyer is
   * charged only if the owner agrees. Calling it again for a completed cart returns the same
   * result; it never charges twice.
   *
   * @returns The order was placed
   *
   * @throws {@link MerchantCart.CheckoutError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  checkout(
    request: MerchantCart.CheckoutRequestParams,
    options?: RequestOptions,
  ): ApiPromise<CheckoutResult, MerchantCart.CheckoutError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/shops/{slug}/merchant-cart/{cartId}/checkout"),
        auth: noneAuth,
        pathParams: [
          { name: "slug", value: request.slug, schema: s.string() },
          { name: "cartId", value: request.cartId, schema: s.string() },
        ],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: checkoutRequestSchema },
      },
      {
        success: { kind: "json", schema: checkoutResultSchema },
        errorFactory: MerchantCart.CheckoutError,
      },
      options,
    );
  }

  /**
   * Create a cart
   *
   * @remarks
   * Prices the cart from the shop's catalog (shipping and tax included) and validates it. A valid
   * cart comes back `CREATED` with `payment_method.approval_url`: send the buyer there to approve
   * in PayPal. An invalid one comes back `INCOMPLETE` with `validation_issues`, each with
   * `resolution_options` an agent can apply before calling `updateCart`.
   *
   * @returns The priced cart
   *
   * @throws {@link MerchantCart.CreateCartError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  createCart(
    request: MerchantCart.CreateCartRequest,
    options?: RequestOptions,
  ): ApiPromise<Cart, MerchantCart.CreateCartError> {
    return this.#rawClient.execute(
      {
        method: "POST",
        urlTemplate: this.#servers.default("/api/shops/{slug}/merchant-cart"),
        auth: noneAuth,
        pathParams: [{ name: "slug", value: request.slug, schema: s.string() }],
        query: [],
        headers: [
          { name: "X-Sayso-Channel", value: request.xSaysoChannel, schema: s.optional(s.string()) },
          { name: "Idempotency-Key", value: uuid(), schema: s.string() },
        ],
        body: { kind: "json", value: request.body, schema: cartRequestSchema },
      },
      {
        success: { kind: "json", schema: cartSchema },
        errorFactory: MerchantCart.CreateCartError,
      },
      options,
    );
  }

  /**
   * Get a cart
   *
   * @remarks
   * The cart as it is now. Once paid, `status` is `COMPLETED`.
   *
   * @returns The cart
   *
   * @throws {@link MerchantCart.GetCartError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  getCart(
    request: MerchantCart.GetCartRequest,
    options?: RequestOptions,
  ): ApiPromise<Cart, MerchantCart.GetCartError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/shops/{slug}/merchant-cart/{cartId}"),
        auth: noneAuth,
        pathParams: [
          { name: "slug", value: request.slug, schema: s.string() },
          { name: "cartId", value: request.cartId, schema: s.string() },
        ],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: cartSchema },
        errorFactory: MerchantCart.GetCartError,
      },
      options,
    );
  }

  /**
   * Replace a cart
   *
   * @remarks
   * Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval
   * link.
   *
   * @returns The re-priced cart
   *
   * @throws {@link MerchantCart.UpdateCartError} when the API answers with an error status — narrow
   * on `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  updateCart(
    request: MerchantCart.UpdateCartRequest,
    options?: RequestOptions,
  ): ApiPromise<Cart, MerchantCart.UpdateCartError> {
    return this.#rawClient.execute(
      {
        method: "PUT",
        urlTemplate: this.#servers.default("/api/shops/{slug}/merchant-cart/{cartId}"),
        auth: noneAuth,
        pathParams: [
          { name: "slug", value: request.slug, schema: s.string() },
          { name: "cartId", value: request.cartId, schema: s.string() },
        ],
        query: [],
        headers: [{ name: "Idempotency-Key", value: uuid(), schema: s.string() }],
        body: { kind: "json", value: request.body, schema: cartRequestSchema },
      },
      {
        success: { kind: "json", schema: cartSchema },
        errorFactory: MerchantCart.UpdateCartError,
      },
      options,
    );
  }
}

export namespace MerchantCart {
  export type CheckoutRequestParams = {
    /** The shop, e.g. maya-ceramics */
    slug: string;
    /** From createCart, e.g. cart_6dadca42ea7819f7 */
    cartId: string;
    body: CheckoutRequest;
  };

  export class CheckoutError extends ApiError {
    declare readonly payload:
      | Declared<"error", Error>
      | Declared<"cart", Cart>
      | Declared<"error2", Error>
      | Undeclared;

    static readonly errors: ErrorDecoders<CheckoutError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 422, kind: "cart", decode: { kind: "json", schema: cartSchema } },
      { on: 502, kind: "error2", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type CreateCartRequest = {
    /** The shop, e.g. maya-ceramics */
    slug: string;
    /** Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt"). */
    xSaysoChannel?: string;
    body: CartRequest;
  };

  export class CreateCartError extends ApiError {
    declare readonly payload:
      | Declared<"error", Error>
      | Declared<"error2", Error>
      | Declared<"error3", Error>
      | Undeclared;

    static readonly errors: ErrorDecoders<CreateCartError> = [
      { on: 400, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 404, kind: "error2", decode: { kind: "json", schema: errorSchema } },
      { on: 502, kind: "error3", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type GetCartRequest = {
    /** The shop, e.g. maya-ceramics */
    slug: string;
    /** From createCart, e.g. cart_6dadca42ea7819f7 */
    cartId: string;
  };

  export class GetCartError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<GetCartError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type UpdateCartRequest = {
    /** The shop, e.g. maya-ceramics */
    slug: string;
    /** From createCart, e.g. cart_6dadca42ea7819f7 */
    cartId: string;
    body: CartRequest;
  };

  export class UpdateCartError extends ApiError {
    declare readonly payload:
      | Declared<"error", Error>
      | Declared<"error2", Error>
      | Declared<"error3", Error>
      | Declared<"error4", Error>
      | Undeclared;

    static readonly errors: ErrorDecoders<UpdateCartError> = [
      { on: 404, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 409, kind: "error2", decode: { kind: "json", schema: errorSchema } },
      { on: 422, kind: "error3", decode: { kind: "json", schema: errorSchema } },
      { on: 502, kind: "error4", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
