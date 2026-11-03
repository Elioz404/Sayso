// An agent platform buying from a Sayso shop through the TypeScript SDK that APIMatic generates from
// public/openapi.yaml: find a shop, search it, build a cart, and hand the buyer PayPal's approval link.
//
//   cd sdk/typescript && npm install          # builds the SDK
//   cd examples/sdk-checkout && npm install
//   node index.ts [origin] [query]            # e.g. node index.ts http://localhost:3000 "green mug"

import { SaysoShopsApiClient } from 'sayso-shops-api';

const origin = process.argv[2] ?? 'http://localhost:3000';
const query = process.argv[3] ?? 'mug';
const client = new SaysoShopsApiClient({ serverOptions: { baseUrl: origin } });

const shops = await client.shops.listShops();
console.log(`${shops.length} shop(s): ${shops.map((s) => `${s.name} (${s.shop})`).join(', ')}`);

for (const { shop: slug } of shops) {
  const offer = await client.shops.searchProducts({ slug, query, inStockOnly: true });
  const variant = offer.products[0]?.variants[0];
  if (!variant) continue;
  console.log(`\n${offer.shop.name}: ${offer.products[0].name}, ${variant.title} at ${variant.price}`);

  // The cart is priced by the shop: shipping, tax and stock are checked server-side.
  const cart = await client.merchantCart.createCart({
    slug,
    xSaysoChannel: 'sdk-example',
    body: {
      items: [{ variantId: variant.variantId, quantity: 1 }],
      shippingAddress: { countryCode: 'US', adminArea1: 'TX', adminArea2: 'Austin', postalCode: '78701', addressLine1: '100 Congress Ave' },
    },
  });
  if (cart.status !== 'CREATED') {
    console.log(`The shop needs something first: ${cart.validationIssues?.map((i) => i.userMessage ?? i.message).join('; ')}`);
    continue;
  }
  console.log(`Cart ${cart.id}: ${cart.totals?.total.value} ${cart.totals?.total.currencyCode} with shipping and tax`);
  console.log(`Send the buyer here to approve in PayPal:\n  ${cart.paymentMethod?.approvalUrl}`);
  console.log(`Then complete it: client.merchantCart.checkout({ slug: '${slug}', cartId: '${cart.id}', body: { paymentMethod: { type: 'paypal', token: '${cart.paymentMethod?.token}' } } })`);
  break;
}
