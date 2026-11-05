// How agents and crawlers find Sayso shops without being told: /llms.txt (a plain-text map for language
// models), schema.org JSON-LD on each shop page (what search engines and shopping crawlers read), and
// the sitemap. All three are built here from the same catalogs and links.

import { available, type Catalog, type Product, type Variant, variantLabel } from './catalog.ts';
import type { Links } from './links.ts';
import { formatMoney, toMoney } from './money.ts';

/** The /llms.txt file: what Sayso is, how an agent buys, and every listed shop. */
export function llmsText(links: Links, shops: readonly Catalog[]): string {
  const lines = [
    '# Sayso',
    '',
    '> Small shops that AI shopping assistants can buy from, paid through PayPal. Each shop is run by its',
    "> owner's own AI agent, and money only moves inside the owner's rules or with their say-so.",
    '',
    'Prices, stock, shipping and tax are always computed by the shop, never by the agent. Payment is',
    "PayPal: the buyer approves in PayPal, or an assistant pays with the buyer's saved PayPal inside limits",
    'the buyer set. Nothing here is real money: this deployment runs on the PayPal sandbox.',
    '',
    '## Buy from any shop',
    '',
    `- [All shops](${links.base}/shops): every shop and its pieces; people buy with a cart or Sayso's own assistant and pay with PayPal's button`,
    `- [Shopping MCP server](${links.shoppingMcp}): every shop, for any MCP client (list_shops, search_products, create_cart, update_cart, get_cart, pay_with_paypal, request_refund)`,
    `- [Shops API (OpenAPI)](${links.openApi}): the same as REST, with PayPal's merchant-cart spec per shop`,
    `- [Developer portal](${links.developers}): guides, SDKs and a console for the API`,
    '',
    '## Shops',
    '',
    ...(shops.length
      ? shops.map(({ shop, products }) => {
          const kinds = [...new Set(products.map((p) => p.category))].slice(0, 4).join(', ');
          return `- [${shop.name}](${links.shopPage(shop.slug)}): ${kinds || 'goods'}, ships from ${shop.country}, prices in ${shop.currency}. MCP: ${links.shopMcp(shop.slug)} · merchant-cart: ${links.merchantCart(shop.slug)}`;
        })
      : ['- No shops are published yet.']),
    '',
    '## Optional',
    '',
    `- [For owners](${links.base}/start): turn photos or a price list into a shop your own agent runs`,
    `- [Docs](${links.base}/docs): how the owner's agent, Guard and the say-so work`,
    '',
  ];
  return lines.join('\n');
}

/** schema.org markup for a shop page: the store, its products and offers, shipping and returns. */
export function shopJsonLd(catalog: Catalog, links: Links): Record<string, unknown> {
  const { shop } = catalog;
  const terms = offerTerms(catalog);
  return {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: shop.name,
    url: links.shopPage(shop.slug),
    image: shop.cover && links.asset(shop.cover.url),
    currenciesAccepted: shop.currency,
    paymentAccepted: 'PayPal',
    hasMerchantReturnPolicy: terms.hasMerchantReturnPolicy,
    makesOffer: catalog.products.flatMap((product) =>
      product.variants.map((variant) => ({
        ...offer(catalog, product, variant, links, terms),
        itemOffered: {
          '@type': 'Product',
          name: variantLabel(product.name, variant.title),
          description: product.description,
          category: product.category,
          image: product.imageUrl && links.asset(product.imageUrl),
          url: links.productPage(shop.slug, product.id),
        },
      })),
    ),
  };
}

/** schema.org markup for one product page: the product, sold by the shop, one offer per variant. */
export function productJsonLd(catalog: Catalog, product: Product, links: Links): Record<string, unknown> {
  const terms = offerTerms(catalog);
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    category: product.category,
    image: product.imageUrl && links.asset(product.imageUrl),
    url: links.productPage(catalog.shop.slug, product.id),
    brand: { '@type': 'Brand', name: catalog.shop.name },
    offers: product.variants.map((variant) => ({ ...offer(catalog, product, variant, links, terms), name: variant.title })),
  };
}

interface OfferTerms {
  shippingDetails: Record<string, unknown>[];
  hasMerchantReturnPolicy: Record<string, unknown>;
}

/** Shipping and returns, the same for every offer of a shop. */
function offerTerms({ shop }: Catalog): OfferTerms {
  const price = (minor: number) => toMoney(minor, shop.currency).value;
  return {
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: shop.country,
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: shop.returnPolicy.days,
      returnFees: shop.returnPolicy.buyerPaysReturn ? 'https://schema.org/ReturnShippingFees' : 'https://schema.org/FreeReturn',
    },
    shippingDetails: shop.shipping.map((rule) => ({
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: price(rule.price), currency: shop.currency },
      shippingDestination: rule.countries.includes('*') ? undefined : rule.countries.map((c) => ({ '@type': 'DefinedRegion', addressCountry: c })),
      deliveryTime: { '@type': 'ShippingDeliveryTime', transitTime: { '@type': 'QuantitativeValue', minValue: rule.minDays, maxValue: rule.maxDays, unitCode: 'DAY' } },
    })),
  };
}

function offer(catalog: Catalog, product: Product, variant: Variant, links: Links, terms: OfferTerms): Record<string, unknown> {
  const { shop } = catalog;
  return {
    '@type': 'Offer',
    sku: variant.id,
    price: toMoney(variant.price, shop.currency).value,
    priceCurrency: shop.currency,
    availability: available(variant) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    url: links.productPage(shop.slug, product.id),
    seller: { '@type': 'Organization', name: shop.name },
    ...terms,
    description: variant.madeToOrderDays !== undefined ? `Made to order in ${variant.madeToOrderDays} days, ${formatMoney(variant.price, shop.currency)}` : undefined,
  };
}

/** JSON-LD for a <script> tag: `<` escaped so a product name can't close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
