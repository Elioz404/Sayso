---
title: Buy from a shop in TypeScript
---

This is the whole agent-side flow with the generated TypeScript SDK. It is the same code as
`examples/sdk-checkout` in the Sayso repository, which runs against a live server.

```ts
import { SaysoShopsApiClient } from 'sayso-shops-api';

const client = new SaysoShopsApiClient({ serverOptions: { baseUrl: 'https://your-sayso-server' } });

// 1. Find a shop and something in stock.
const [{ shop: slug }] = await client.shops.listShops();
const offer = await client.shops.searchProducts({ slug, query: 'mug', inStockOnly: true });
const variant = offer.products[0].variants[0];

// 2. Price a cart. The shop sets shipping, tax and stock.
const cart = await client.merchantCart.createCart({
  slug,
  xSaysoChannel: 'my-agent',
  body: {
    items: [{ variantId: variant.variantId, quantity: 1 }],
    shippingAddress: { countryCode: 'US', adminArea1: 'TX', adminArea2: 'Austin', postalCode: '78701' },
  },
});

// 3. Send the buyer to PayPal to approve.
console.log(cart.paymentMethod?.approvalUrl);

// 4. After they approve, complete the order.
const done = await client.merchantCart.checkout({
  slug,
  cartId: cart.id!,
  body: { paymentMethod: { type: 'paypal', token: cart.paymentMethod!.token! } },
});
console.log(done.paymentConfirmation.merchantOrderNumber, done.paymentConfirmation.paymentStatus);
```

## When the cart has issues

If `cart.status` is `INCOMPLETE`, read `cart.validationIssues`. Each issue has a `userMessage` you can
show the buyer and `resolutionOptions` such as `REDUCE_QUANTITY` or `REPLACE_VARIANT`. Apply one and call
`updateCart` with the whole cart.

## What the buyer is charged

Nothing until they approve in PayPal, and nothing at all if the shop can't fulfil the order: Sayso
authorizes first, takes the stock, and only then captures through the shop's Guard.
