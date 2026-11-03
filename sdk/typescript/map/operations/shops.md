<!-- Generated file — do not edit; regenerated with the SDK. -->

# Shops — operations

Accessor: `client.shops` · Source: `src/resources/shops.ts` · 2 operations · Request and error types: namespace `Shops`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `sayso-shops-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### listShops

- **Signature**: `listShops(options?: RequestOptions): ApiPromise<ShopSummary[], Shops.ListShopsError>`
- **Wire**: `GET /api/shops`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ShopSummary[]` — a bare `application/json` array; the success type *is* the array, not a wrapper model
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `Shops.ListShopsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [500] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

| Type | Schema value | Source |
| --- | --- | --- |
| `ShopSummary` | `shopSummarySchema` | `src/models/shop-summary.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### searchProducts

- **Signature**: `searchProducts(request: Shops.SearchProductsRequest, options?: RequestOptions): ApiPromise<ShopOffer, Shops.SearchProductsError>`
- **Wire**: `GET /api/shops/{slug}/products`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `ShopOffer`
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `Shops.SearchProductsError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [400] `Error` · `"error2"` [404] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `Shops.SearchProductsRequest` (4):

| Field | Channel | Wire | Type | Req | Default |
| --- | --- | --- | --- | --- | --- |
| `slug` | `path` | — | `string` | yes | — |
| `query` | `query` | — | `string` | no | — |
| `maxPrice` | `query` | `max_price` | `string` | no | — |
| `inStockOnly` | `query` | `in_stock_only` | `boolean` | no | `false` |

| Type | Schema value | Source |
| --- | --- | --- |
| `ShopOffer` | `shopOfferSchema` | `src/models/shop-offer.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

