import { ApiError, type Declared, type Undeclared } from "../core/api-error.js";
import type { ApiPromise } from "../core/api-promise.js";
import type { RequestOptions } from "../core/api-request.js";
import { noneAuth } from "../core/auth/schemes.js";
import type { RawClient } from "../core/raw-client.js";
import type { ErrorDecoders } from "../core/response-decoder.js";
import * as s from "../core/validation/index.js";
import { errorSchema, type Error } from "../models/error.js";
import { shopOfferSchema, type ShopOffer } from "../models/shop-offer.js";
import { shopSummarySchema, type ShopSummary } from "../models/shop-summary.js";
import type { Servers } from "../servers.js";

/**
 * Find shops and what they sell.
 */
export class Shops {
  readonly #rawClient: RawClient;
  readonly #servers: Servers;

  constructor(rawClient: RawClient, servers: Servers) {
    this.#rawClient = rawClient;
    this.#servers = servers;
  }

  /**
   * List shops
   *
   * @remarks
   * Every published shop, with what it sells and where it ships from.
   *
   * @returns Published shops
   *
   * @throws {@link Shops.ListShopsError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  listShops(options?: RequestOptions): ApiPromise<ShopSummary[], Shops.ListShopsError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/shops"),
        auth: noneAuth,
        pathParams: [],
        query: [],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: s.array(s.lazy(() => shopSummarySchema)) },
        errorFactory: Shops.ListShopsError,
      },
      options,
    );
  }

  /**
   * Search a shop's products
   *
   * @remarks
   * Products whose name, description, category or tags contain every word of `query`.
   *
   * @returns What the shop offers for this search
   *
   * @throws {@link Shops.SearchProductsError} when the API answers with an error status — narrow on
   * `err.payload.kind`
   *
   * @throws {@link SaysoShopsApiError} when no usable response was produced: a connection failure,
   * a timeout, a body that would not decode, a value that would not encode, or a credential that
   * could not be obtained
   */
  searchProducts(
    request: Shops.SearchProductsRequest,
    options?: RequestOptions,
  ): ApiPromise<ShopOffer, Shops.SearchProductsError> {
    return this.#rawClient.execute(
      {
        method: "GET",
        urlTemplate: this.#servers.default("/api/shops/{slug}/products"),
        auth: noneAuth,
        pathParams: [{ name: "slug", value: request.slug, schema: s.string() }],
        query: [
          { name: "query", value: request.query, schema: s.optional(s.string()) },
          { name: "max_price", value: request.maxPrice, schema: s.optional(s.string()) },
          { name: "in_stock_only", value: request.inStockOnly, schema: s.defaulted(s.boolean(), false) },
        ],
        headers: [],
        body: { kind: "empty" },
      },
      {
        success: { kind: "json", schema: shopOfferSchema },
        errorFactory: Shops.SearchProductsError,
      },
      options,
    );
  }
}

export namespace Shops {
  export class ListShopsError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Undeclared;

    static readonly errors: ErrorDecoders<ListShopsError> = [
      { on: 500, kind: "error", decode: { kind: "json", schema: errorSchema } },
    ];
  }

  export type SearchProductsRequest = {
    /** The shop, e.g. maya-ceramics */
    slug: string;
    /** Words to match, e.g. "green mug". Leave out to list everything. */
    query?: string;
    /** Highest price per item in the shop's currency, e.g. "40.00". */
    maxPrice?: string;
    /** Leave out sold-out variants (made-to-order ones always stay). @default false */
    inStockOnly?: boolean;
  };

  export class SearchProductsError extends ApiError {
    declare readonly payload: Declared<"error", Error> | Declared<"error2", Error> | Undeclared;

    static readonly errors: ErrorDecoders<SearchProductsError> = [
      { on: 400, kind: "error", decode: { kind: "json", schema: errorSchema } },
      { on: 404, kind: "error2", decode: { kind: "json", schema: errorSchema } },
    ];
  }
}
