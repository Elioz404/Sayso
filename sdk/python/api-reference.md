# Reference

**Parsed** endpoints return the typed payload and raise `ApiError` on a documented non-2xx. For the raw endpoints, see [Raw API Reference](raw-api-reference.md).

> Source: [SaysoShopsApiClient](sayso_shops_api/client.py)

## MerchantCart

> Source: [MerchantCart](sayso_shops_api/apis/merchant_cart.py)

<details>
<summary><code>def checkout(slug: str, cart_id: str, body: CheckoutRequest | CheckoutRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> CheckoutResult</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Call after the buyer approved in PayPal. Sayso re-checks stock and price, authorizes the payment,
takes the stock and submits the capture to the shop's Guard. Big orders may wait for the owner:
then `payment_status` is `AUTHORIZED_PENDING_MERCHANT_REVIEW` and the buyer is charged only if the
owner agrees. Calling it again for a completed cart returns the same result; it never charges twice.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.merchant_cart.checkout(
        "some example string",
        "some example string",
        CheckoutRequest(payment_method=PaymentMethod1(token="some example string")),
    )
    # TODO: Handle 'response' of type CheckoutResult
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type CheckoutErrorBody
```

**Async**

```python
try:
    response = await async_client.merchant_cart.checkout(
        "some example string",
        "some example string",
        CheckoutRequest(payment_method=PaymentMethod1(token="some example string")),
    )
    # TODO: Handle 'response' of type CheckoutResult
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type CheckoutErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>str</code> | The shop, e.g. maya-ceramics |
| <code>cart_id</code> | <code>str</code> | From createCart, e.g. cart_6dadca42ea7819f7 |
| <code>body</code> | <code>[CheckoutRequest](sayso_shops_api/models/checkout_request.py) \| [CheckoutRequestDict](sayso_shops_api/models/checkout_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[CheckoutResult](sayso_shops_api/models/checkout_result.py)</code> -- The order was placed

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[CheckoutErrorBody](sayso_shops_api/errors/checkout_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 404, 502 | <code>[Error](sayso_shops_api/models/error.py)</code> |
| 422 | <code>[Cart](sayso_shops_api/models/cart.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def create_cart(slug: str, body: CartRequest | CartRequestDict, *, x_sayso_channel: str | None = None, request_options: RequestOptionsOrDict | None = None) -> Cart</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Prices the cart from the shop's catalog (shipping and tax included) and validates it. A valid cart
comes back `CREATED` with `payment_method.approval_url`: send the buyer there to approve in PayPal.
An invalid one comes back `INCOMPLETE` with `validation_issues`, each with `resolution_options`
an agent can apply before calling `updateCart`.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.merchant_cart.create_cart("some example string", CartRequest(items=[CartItem(quantity=1)]))
    # TODO: Handle 'response' of type Cart
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type CreateCartErrorBody
```

**Async**

```python
try:
    response = await async_client.merchant_cart.create_cart(
        "some example string", CartRequest(items=[CartItem(quantity=1)])
    )
    # TODO: Handle 'response' of type Cart
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type CreateCartErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>str</code> | The shop, e.g. maya-ceramics |
| <code>body</code> | <code>[CartRequest](sayso_shops_api/models/cart_request.py) \| [CartRequestDict](sayso_shops_api/models/cart_request.py)</code> | The request body. |
| <code>x_sayso_channel</code> | <code>str \| None</code> | Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt").<br>**Default**: <code>None</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Cart](sayso_shops_api/models/cart.py)</code> -- The priced cart

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[CreateCartErrorBody](sayso_shops_api/errors/create_cart_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 404, 502 | <code>[Error](sayso_shops_api/models/error.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def get_cart(slug: str, cart_id: str, *, request_options: RequestOptionsOrDict | None = None) -> Cart</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The cart as it is now. Once paid, `status` is `COMPLETED`.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.merchant_cart.get_cart("some example string", "some example string")
    # TODO: Handle 'response' of type Cart
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type GetCartErrorBody
```

**Async**

```python
try:
    response = await async_client.merchant_cart.get_cart("some example string", "some example string")
    # TODO: Handle 'response' of type Cart
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type GetCartErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>str</code> | The shop, e.g. maya-ceramics |
| <code>cart_id</code> | <code>str</code> | From createCart, e.g. cart_6dadca42ea7819f7 |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Cart](sayso_shops_api/models/cart.py)</code> -- The cart

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[GetCartErrorBody](sayso_shops_api/errors/get_cart_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 404 | <code>[Error](sayso_shops_api/models/error.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def update_cart(slug: str, cart_id: str, body: CartRequest | CartRequestDict, *, request_options: RequestOptionsOrDict | None = None) -> Cart</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval link.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.merchant_cart.update_cart(
        "some example string", "some example string", CartRequest(items=[CartItem(quantity=1)])
    )
    # TODO: Handle 'response' of type Cart
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type UpdateCartErrorBody
```

**Async**

```python
try:
    response = await async_client.merchant_cart.update_cart(
        "some example string", "some example string", CartRequest(items=[CartItem(quantity=1)])
    )
    # TODO: Handle 'response' of type Cart
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type UpdateCartErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>str</code> | The shop, e.g. maya-ceramics |
| <code>cart_id</code> | <code>str</code> | From createCart, e.g. cart_6dadca42ea7819f7 |
| <code>body</code> | <code>[CartRequest](sayso_shops_api/models/cart_request.py) \| [CartRequestDict](sayso_shops_api/models/cart_request.py)</code> | The request body. |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Cart](sayso_shops_api/models/cart.py)</code> -- The re-priced cart

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[UpdateCartErrorBody](sayso_shops_api/errors/update_cart_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 404, 409, 422, 502 | <code>[Error](sayso_shops_api/models/error.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Service

> Source: [Service](sayso_shops_api/apis/service.py)

<details>
<summary><code>def health(*, request_options: RequestOptionsOrDict | None = None) -> Health</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Send a `GET` request.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.service.health()
    # TODO: Handle 'response' of type Health
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type HealthErrorBody
```

**Async**

```python
try:
    response = await async_client.service.health()
    # TODO: Handle 'response' of type Health
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type HealthErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[Health](sayso_shops_api/models/health.py)</code> -- The server and its storage answer

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[HealthErrorBody](sayso_shops_api/errors/health_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 503 | <code>[Health](sayso_shops_api/models/health.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

## Shops

> Source: [Shops](sayso_shops_api/apis/shops.py)

<details>
<summary><code>def list_shops(*, request_options: RequestOptionsOrDict | None = None) -> list[ShopSummary]</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Every published shop, with what it sells and where it ships from.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.shops.list_shops()
    # TODO: Handle 'response' of type list[ShopSummary]
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type ListShopsErrorBody
```

**Async**

```python
try:
    response = await async_client.shops.list_shops()
    # TODO: Handle 'response' of type list[ShopSummary]
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type ListShopsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>list&#91;[ShopSummary](sayso_shops_api/models/shop_summary.py)&#93;</code> -- Published shops

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[ListShopsErrorBody](sayso_shops_api/errors/list_shops_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 500 | <code>[Error](sayso_shops_api/models/error.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>def search_products(slug: str, *, query: str | None = None, max_price: str | None = None, in_stock_only: bool | None = False, request_options: RequestOptionsOrDict | None = None) -> ShopOffer</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Products whose name, description, category or tags contain every word of `query`.

</dd>
</dl>

### Usage

<dl>
<dd>

**Sync**

```python
try:
    response = client.shops.search_products("some example string")
    # TODO: Handle 'response' of type ShopOffer
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type SearchProductsErrorBody
```

**Async**

```python
try:
    response = await async_client.shops.search_products("some example string")
    # TODO: Handle 'response' of type ShopOffer
except ApiError as e:
    ...  # TODO: Handle 'e.error' of type SearchProductsErrorBody
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>str</code> | The shop, e.g. maya-ceramics |
| <code>query</code> | <code>str \| None</code> | Words to match, e.g. "green mug". Leave out to list everything.<br>**Default**: <code>None</code> |
| <code>max_price</code> | <code>str \| None</code> | Highest price per item in the shop's currency, e.g. "40.00".<br>**Default**: <code>None</code> |
| <code>in_stock_only</code> | <code>bool \| None</code> | Leave out sold-out variants (made-to-order ones always stay).<br>**Default**: <code>False</code> |
| <code>request_options</code> | <code>[RequestOptionsOrDict](sayso_shops_api/core/request_options.py) \| None</code> | Per-call overrides for this one request, such as a timeout, extra headers, or its retry count and statuses. |

</dd>
</dl>

### Response

<dl>
<dd>

**OnSuccess**: <code>[ShopOffer](sayso_shops_api/models/shop_offer.py)</code> -- What the shop offers for this search

**OnError**: <code>[ApiError](sayso_shops_api/core/exceptions.py)&#91;[SearchProductsErrorBody](sayso_shops_api/errors/search_products_error.py)&#93;</code>

Mapped in first-match order -- an earlier row wins over a later range that also covers the status:

| Status | `error` is |
| --- | --- |
| 400, 404 | <code>[Error](sayso_shops_api/models/error.py)</code> |
| anything unmapped | <code>[RawError](sayso_shops_api/core/results.py)</code> |

</dd>
</dl>

</dd>
</dl>

</details>

