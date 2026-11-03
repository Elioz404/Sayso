<!-- Generated file — do not edit; regenerated with the SDK. -->

# MerchantCart — operations

Accessor: `client.merchantCart` · Source: `src/resources/merchant-cart.ts` · 4 operations · Request and error types: namespace `MerchantCart`

**Type sources**: every type an operation names, with the file that declares it and the schema value exported beside it. Import every name from `sayso-shops-api`; the `Source` path is where to **read** the shape, never what to import. `ApiError`, the runtime error family and the file vocabulary are excluded — see sdk-map.md.

### checkout

- **Signature**: `checkout(request: MerchantCart.CheckoutRequestParams, options?: RequestOptions): ApiPromise<CheckoutResult, MerchantCart.CheckoutError>`
- **Wire**: `POST /api/shops/{slug}/merchant-cart/{cartId}/checkout`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `CheckoutResult`
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `MerchantCart.CheckoutError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"cart"` [422] `Cart` · `"error2"` [502] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `MerchantCart.CheckoutRequestParams` (3):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `slug` | `path` | `string` | yes |
| `cartId` | `path` | `string` | yes |
| `body` | `body` | `CheckoutRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `CheckoutRequest` | `checkoutRequestSchema` | `src/models/checkout-request.ts` |
| `CheckoutResult` | `checkoutResultSchema` | `src/models/checkout-result.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |
| `Cart` | `cartSchema` | `src/models/cart.ts` |

### createCart

- **Signature**: `createCart(request: MerchantCart.CreateCartRequest, options?: RequestOptions): ApiPromise<Cart, MerchantCart.CreateCartError>`
- **Wire**: `POST /api/shops/{slug}/merchant-cart`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `Cart`
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `MerchantCart.CreateCartError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [400] `Error` · `"error2"` [404] `Error` · `"error3"` [502] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `MerchantCart.CreateCartRequest` (3):

| Field | Channel | Wire | Type | Req |
| --- | --- | --- | --- | --- |
| `slug` | `path` | — | `string` | yes |
| `xSaysoChannel` | `header` | `X-Sayso-Channel` | `string` | no |
| `body` | `body` | — | `CartRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `CartRequest` | `cartRequestSchema` | `src/models/cart-request.ts` |
| `Cart` | `cartSchema` | `src/models/cart.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### getCart

- **Signature**: `getCart(request: MerchantCart.GetCartRequest, options?: RequestOptions): ApiPromise<Cart, MerchantCart.GetCartError>`
- **Wire**: `GET /api/shops/{slug}/merchant-cart/{cartId}`
- **Auth**: none — public; no credential is sent
- **Request body**: none — no `Content-Type` header is sent
- **Returns**: `Cart`
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `MerchantCart.GetCartError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `MerchantCart.GetCartRequest` (2):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `slug` | `path` | `string` | yes |
| `cartId` | `path` | `string` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `Cart` | `cartSchema` | `src/models/cart.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

### updateCart

- **Signature**: `updateCart(request: MerchantCart.UpdateCartRequest, options?: RequestOptions): ApiPromise<Cart, MerchantCart.UpdateCartError>`
- **Wire**: `PUT /api/shops/{slug}/merchant-cart/{cartId}`
- **Auth**: none — public; no credential is sent
- **Request body**: `application/json` — the `body` field
- **SDK-sent**: `header Idempotency-Key` (minted per call)
- **Returns**: `Cart`
- **Error**: `SaysoShopsApiError` with `kind: "api"`, an instance of `MerchantCart.UpdateCartError` — **typed arms**, narrowed on `err.payload.kind`
- **Error arms**: `"error"` [404] `Error` · `"error2"` [409] `Error` · `"error3"` [422] `Error` · `"error4"` [502] `Error` · `"undeclared"` [any other] `rawBody: ArrayBuffer`

**Fields** — `MerchantCart.UpdateCartRequest` (3):

| Field | Channel | Type | Req |
| --- | --- | --- | --- |
| `slug` | `path` | `string` | yes |
| `cartId` | `path` | `string` | yes |
| `body` | `body` | `CartRequest` | yes |

| Type | Schema value | Source |
| --- | --- | --- |
| `CartRequest` | `cartRequestSchema` | `src/models/cart-request.ts` |
| `Cart` | `cartSchema` | `src/models/cart.ts` |
| `Error` | `errorSchema` | `src/models/error.ts` |

