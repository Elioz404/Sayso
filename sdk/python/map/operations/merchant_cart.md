<!-- Generated file — do not edit; regenerated with the SDK. -->

# MerchantCart — operations

Accessor: `client.merchant_cart` · Source: `sayso_shops_api/apis/merchant_cart.py` · 4 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.merchant_cart.checkout

- **Route**: `POST /api/shops/{slug}/merchant-cart/{cartId}/checkout`
- **Signature**: `def checkout(slug: str, cart_id: str, body: CheckoutRequest | CheckoutRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `slug`, `cart_id`, `body`
- **Params**: `slug` — path · `cart_id` — path `cartId` · `body` — JSON body
- **Returns (parsed)**: `CheckoutResult`
- **Returns (raw)**: `ApiResult[CheckoutResult, CheckoutErrorBody]`
- **Error**: `CheckoutErrorBody` — **Case A (typed)**
- **Error arms**: `Error` [404, 502] · `Cart` [422] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `CheckoutRequest` | `sayso_shops_api/models/checkout_request.py` |
| `CheckoutRequestDict` | `sayso_shops_api/models/checkout_request.py` |
| `CheckoutResult` | `sayso_shops_api/models/checkout_result.py` |
| `CheckoutErrorBody` | `sayso_shops_api/errors/checkout_error.py` |
| `Error` | `sayso_shops_api/models/error.py` |
| `Cart` | `sayso_shops_api/models/cart.py` |

### client.merchant_cart.create_cart

- **Route**: `POST /api/shops/{slug}/merchant-cart`
- **Signature**: `def create_cart(slug: str, body: CartRequest | CartRequestDict, *, x_sayso_channel: str | None = None, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `slug`, `body`
- **Params**: `slug` — path · `x_sayso_channel` — header `X-Sayso-Channel` · `body` — JSON body
- **Returns (parsed)**: `Cart`
- **Returns (raw)**: `ApiResult[Cart, CreateCartErrorBody]`
- **Error**: `CreateCartErrorBody` — **Case A (typed)**
- **Error arms**: `Error` [400, 404, 502] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `CartRequest` | `sayso_shops_api/models/cart_request.py` |
| `CartRequestDict` | `sayso_shops_api/models/cart_request.py` |
| `Cart` | `sayso_shops_api/models/cart.py` |
| `CreateCartErrorBody` | `sayso_shops_api/errors/create_cart_error.py` |
| `Error` | `sayso_shops_api/models/error.py` |

### client.merchant_cart.get_cart

- **Route**: `GET /api/shops/{slug}/merchant-cart/{cartId}`
- **Signature**: `def get_cart(slug: str, cart_id: str, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `slug`, `cart_id`
- **Params**: `slug` — path · `cart_id` — path `cartId`
- **Returns (parsed)**: `Cart`
- **Returns (raw)**: `ApiResult[Cart, GetCartErrorBody]`
- **Error**: `GetCartErrorBody` — **Case A (typed)**
- **Error arms**: `Error` [404] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `Cart` | `sayso_shops_api/models/cart.py` |
| `GetCartErrorBody` | `sayso_shops_api/errors/get_cart_error.py` |
| `Error` | `sayso_shops_api/models/error.py` |

### client.merchant_cart.update_cart

- **Route**: `PUT /api/shops/{slug}/merchant-cart/{cartId}`
- **Signature**: `def update_cart(slug: str, cart_id: str, body: CartRequest | CartRequestDict, *, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `slug`, `cart_id`, `body`
- **Params**: `slug` — path · `cart_id` — path `cartId` · `body` — JSON body
- **Returns (parsed)**: `Cart`
- **Returns (raw)**: `ApiResult[Cart, UpdateCartErrorBody]`
- **Error**: `UpdateCartErrorBody` — **Case A (typed)**
- **Error arms**: `Error` [404, 409, 422, 502] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `CartRequest` | `sayso_shops_api/models/cart_request.py` |
| `CartRequestDict` | `sayso_shops_api/models/cart_request.py` |
| `Cart` | `sayso_shops_api/models/cart.py` |
| `UpdateCartErrorBody` | `sayso_shops_api/errors/update_cart_error.py` |
| `Error` | `sayso_shops_api/models/error.py` |

