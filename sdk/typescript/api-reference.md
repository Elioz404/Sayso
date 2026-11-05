# Reference

> Source: [SaysoShopsApiClient](src/client.ts)

## Shops

> Source: [Shops](src/resources/shops.ts)

<details>
<summary><code>listShops(options?: RequestOptions): ApiPromise&lt;ShopSummary[], Shops.ListShopsError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Every published shop, with what it sells and where it ships from.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.shops.listShops();
  // TODO: Handle 'response' of type ShopSummary[]
} catch (err) {
  // TODO: Handle 'err' of type Shops.ListShopsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.shops.listShops().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ShopSummary[]
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.shops.listShops()`

- **OnSuccess**: <code>[ShopSummary](src/models/shop-summary.ts)[]</code>
- **OnError**: throws <code>[Shops.ListShopsError](src/resources/shops.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.shops.listShops().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ShopSummary[], Shops.ListShopsError&gt;</code>, with `result.value` of type <code>[ShopSummary](src/models/shop-summary.ts)[]</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>searchProducts(request: Shops.SearchProductsRequest, options?: RequestOptions): ApiPromise&lt;ShopOffer, Shops.SearchProductsError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Products whose name, description, category or tags contain every word of `query`.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.shops.searchProducts({ slug: "some example string" });
  // TODO: Handle 'response' of type ShopOffer
} catch (err) {
  // TODO: Handle 'err' of type Shops.SearchProductsError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.shops.searchProducts({ slug: "some example string" }).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type ShopOffer
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>string</code> | The shop, e.g. maya-ceramics |
| <code>query?</code> | <code>string</code> | Words to match, e.g. "green mug". Leave out to list everything. |
| <code>maxPrice?</code> | <code>string</code> | Highest price per item in the shop's currency, e.g. "40.00" or "$40". No more decimals than the currency has. |
| <code>inStockOnly?</code> | <code>boolean</code> | Leave out sold-out variants (made-to-order ones always stay). "true" or "1".<br>**Default**: false |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.shops.searchProducts(request)`

- **OnSuccess**: <code>[ShopOffer](src/models/shop-offer.ts)</code>
- **OnError**: throws <code>[Shops.SearchProductsError](src/resources/shops.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.shops.searchProducts(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;ShopOffer, Shops.SearchProductsError&gt;</code>, with `result.value` of type <code>[ShopOffer](src/models/shop-offer.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## MerchantCart

> Source: [MerchantCart](src/resources/merchant-cart.ts)

<details>
<summary><code>checkout(request: MerchantCart.CheckoutRequestParams, options?: RequestOptions): ApiPromise&lt;CheckoutResult, MerchantCart.CheckoutError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.merchantCart.checkout({
    slug: "some example string",
    cartId: "some example string",
    body: { paymentMethod: { token: "some example string" } },
  });
  // TODO: Handle 'response' of type CheckoutResult
} catch (err) {
  // TODO: Handle 'err' of type MerchantCart.CheckoutError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.merchantCart.checkout({
  slug: "some example string",
  cartId: "some example string",
  body: { paymentMethod: { token: "some example string" } },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type CheckoutResult
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>string</code> | The shop, e.g. maya-ceramics |
| <code>cartId</code> | <code>string</code> | From createCart, e.g. cart_6dadca42ea7819f7 |
| <code>body</code> | <code>[CheckoutRequest](src/models/checkout-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.merchantCart.checkout(request)`

- **OnSuccess**: <code>[CheckoutResult](src/models/checkout-result.ts)</code>
- **OnError**: throws <code>[MerchantCart.CheckoutError](src/resources/merchant-cart.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.merchantCart.checkout(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;CheckoutResult, MerchantCart.CheckoutError&gt;</code>, with `result.value` of type <code>[CheckoutResult](src/models/checkout-result.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>createCart(request: MerchantCart.CreateCartRequest, options?: RequestOptions): ApiPromise&lt;Cart, MerchantCart.CreateCartError&gt;</code></summary>

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

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.merchantCart.createCart({
    slug: "some example string",
    body: { items: [{ quantity: 1 }] },
  });
  // TODO: Handle 'response' of type Cart
} catch (err) {
  // TODO: Handle 'err' of type MerchantCart.CreateCartError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.merchantCart.createCart({
  slug: "some example string",
  body: { items: [{ quantity: 1 }] },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Cart
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>string</code> | The shop, e.g. maya-ceramics |
| <code>xSaysoChannel?</code> | <code>string</code> | Which assistant or platform is shopping, shown to the shop owner (e.g. "chatgpt"). |
| <code>body</code> | <code>[CartRequest](src/models/cart-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.merchantCart.createCart(request)`

- **OnSuccess**: <code>[Cart](src/models/cart.ts)</code>
- **OnError**: throws <code>[MerchantCart.CreateCartError](src/resources/merchant-cart.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.merchantCart.createCart(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Cart, MerchantCart.CreateCartError&gt;</code>, with `result.value` of type <code>[Cart](src/models/cart.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>getCart(request: MerchantCart.GetCartRequest, options?: RequestOptions): ApiPromise&lt;Cart, MerchantCart.GetCartError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

The cart as it is now. Once paid, `status` is `COMPLETED` and `payment_confirmation` says which order it became, as the checkout answered.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.merchantCart.getCart({
    slug: "some example string",
    cartId: "some example string",
  });
  // TODO: Handle 'response' of type Cart
} catch (err) {
  // TODO: Handle 'err' of type MerchantCart.GetCartError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.merchantCart.getCart({
  slug: "some example string",
  cartId: "some example string",
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Cart
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>string</code> | The shop, e.g. maya-ceramics |
| <code>cartId</code> | <code>string</code> | From createCart, e.g. cart_6dadca42ea7819f7 |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.merchantCart.getCart(request)`

- **OnSuccess**: <code>[Cart](src/models/cart.ts)</code>
- **OnError**: throws <code>[MerchantCart.GetCartError](src/resources/merchant-cart.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.merchantCart.getCart(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Cart, MerchantCart.GetCartError&gt;</code>, with `result.value` of type <code>[Cart](src/models/cart.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

<details>
<summary><code>updateCart(request: MerchantCart.UpdateCartRequest, options?: RequestOptions): ApiPromise&lt;Cart, MerchantCart.UpdateCartError&gt;</code></summary>

<dl>
<dd>

### Description

<dl>
<dd>

Replaces the whole cart, per the merchant-cart spec. A changed total gets a new PayPal approval link.

</dd>
</dl>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.merchantCart.updateCart({
    slug: "some example string",
    cartId: "some example string",
    body: { items: [{ quantity: 1 }] },
  });
  // TODO: Handle 'response' of type Cart
} catch (err) {
  // TODO: Handle 'err' of type MerchantCart.UpdateCartError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.merchantCart.updateCart({
  slug: "some example string",
  cartId: "some example string",
  body: { items: [{ quantity: 1 }] },
}).asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Cart
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Parameters

<dl>
<dd>

| Name | Type | Description |
| --- | --- | --- |
| <code>slug</code> | <code>string</code> | The shop, e.g. maya-ceramics |
| <code>cartId</code> | <code>string</code> | From createCart, e.g. cart_6dadca42ea7819f7 |
| <code>body</code> | <code>[CartRequest](src/models/cart-request.ts)</code> | - |

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.merchantCart.updateCart(request)`

- **OnSuccess**: <code>[Cart](src/models/cart.ts)</code>
- **OnError**: throws <code>[MerchantCart.UpdateCartError](src/resources/merchant-cart.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.merchantCart.updateCart(request).asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Cart, MerchantCart.UpdateCartError&gt;</code>, with `result.value` of type <code>[Cart](src/models/cart.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

## Service

> Source: [Service](src/resources/service.ts)

<details>
<summary><code>health(options?: RequestOptions): ApiPromise&lt;Health, Service.HealthApiError&gt;</code></summary>

<dl>
<dd>

### Direct Usage

<dl>
<dd>

```ts
try {
  const response = await client.service.health();
  // TODO: Handle 'response' of type Health
} catch (err) {
  // TODO: Handle 'err' of type Service.HealthApiError, discriminated with 'err.payload.kind'
}
```

</dd>
</dl>

### Usage as ApiResult

<dl>
<dd>

```ts
const result = await client.service.health().asApiResult();
// TODO: Use 'result.status' and 'result.headers' to read the raw response status and headers
if (result.ok) {
  // TODO: Use 'result.value' of type Health
} else {
  // TODO: Handle 'result', discriminated with 'result.payload.kind'
}
```

</dd>
</dl>

### Response

<dl>
<dd>

**Direct**: `await client.service.health()`

- **OnSuccess**: <code>[Health](src/models/health.ts)</code>
- **OnError**: throws <code>[Service.HealthApiError](src/resources/service.ts)</code>, with `err.payload` discriminated on `kind`

**As ApiResult**: `await client.service.health().asApiResult()`

- **OnSuccess**: <code>[ApiResult](src/core/api-promise.ts)&lt;Health, Service.HealthApiError&gt;</code>, with `result.value` of type <code>[Health](src/models/health.ts)</code>
- **OnError**: `result.payload` discriminated on `kind`, with `result.message`

**Thrown**: <code>[SaysoShopsApiError](src/core/errors.ts)</code> on any operational failure — a caller abort and a programmer error stay outside the family and reach you raw

</dd>
</dl>

</dd>
</dl>

</details>

