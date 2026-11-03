<!-- Generated file — do not edit; regenerated with the SDK. -->

# Shops — operations

Accessor: `client.shops` · Source: `sayso_shops_api/apis/shops.py` · 2 operations

Each `###` block is one operation and assumes `sdk-map.md` is loaded: blocks omit what its invariants table covers and are otherwise self-contained, so chunk at block level. Signatures are the sync parsed spelling; the async and raw spellings take the same parameters (see sdk-map.md). **Type sources** names the module declaring each type an operation mentions, so resolving a body, return or error payload is a lookup rather than a search; the runtime types `RawError` and `ApiResult` are excluded.

### client.shops.list_shops

- **Route**: `GET /api/shops`
- **Signature**: `def list_shops(*, request_options: RequestOptionsOrDict | None = None)`
- **Returns (parsed)**: `list[ShopSummary]`
- **Returns (raw)**: `ApiResult[list[ShopSummary], ListShopsErrorBody]`
- **Error**: `ListShopsErrorBody` — **Case A (typed)**
- **Error arms**: `Error` [500] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ShopSummary` | `sayso_shops_api/models/shop_summary.py` |
| `ListShopsErrorBody` | `sayso_shops_api/errors/list_shops_error.py` |
| `Error` | `sayso_shops_api/models/error.py` |

### client.shops.search_products

- **Route**: `GET /api/shops/{slug}/products`
- **Signature**: `def search_products(slug: str, *, query: str | None = None, max_price: str | None = None, in_stock_only: bool | None = False, request_options: RequestOptionsOrDict | None = None)`
  - required, positional: `slug`
- **Params**: `slug` — path · `query` — query · `max_price` — query · `in_stock_only` — query
- **Returns (parsed)**: `ShopOffer`
- **Returns (raw)**: `ApiResult[ShopOffer, SearchProductsErrorBody]`
- **Error**: `SearchProductsErrorBody` — **Case A (typed)**
- **Error arms**: `Error` [400, 404] · `RawError` [anything unmapped]

| Type | Source |
| --- | --- |
| `ShopOffer` | `sayso_shops_api/models/shop_offer.py` |
| `SearchProductsErrorBody` | `sayso_shops_api/errors/search_products_error.py` |
| `Error` | `sayso_shops_api/models/error.py` |

