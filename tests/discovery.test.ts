import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { jsonLdScript, llmsText, shopJsonLd } from '../src/core/discovery.ts';
import { links } from '../src/core/links.ts';

const site = links('https://sayso.example');

test('llms.txt points agents at the shopping MCP, the API and every listed shop', () => {
  const text = llmsText(site, [demoCatalog]);
  assert.match(text, /^# Sayso\n/);
  assert.ok(text.includes(site.shoppingMcp));
  assert.ok(text.includes(site.openApi));
  assert.ok(text.includes(`[${demoCatalog.shop.name}](${site.shopPage(demoCatalog.shop.slug)})`));
  assert.ok(text.includes(site.merchantCart(demoCatalog.shop.slug)));
  assert.match(llmsText(site, []), /No shops are published yet/);
});

test('a shop page describes every variant as a schema.org offer with its price, stock and returns', () => {
  const data = shopJsonLd(demoCatalog, site) as { '@type': string; makesOffer: { price: string; priceCurrency: string; availability: string; sku: string }[] };
  const variants = demoCatalog.products.flatMap((p) => p.variants);
  assert.equal(data['@type'], 'Store');
  assert.equal(data.makesOffer.length, variants.length);
  const first = variants[0];
  const offer = data.makesOffer.find((o) => o.sku === first.id)!;
  assert.equal(offer.price, (first.price / 100).toFixed(2));
  assert.equal(offer.priceCurrency, demoCatalog.shop.currency);
  assert.match(offer.availability, /InStock|OutOfStock/);
});

test('JSON-LD cannot close its script tag', () => {
  assert.equal(jsonLdScript({ name: '</script><script>alert(1)</script>' }).includes('</script>'), false);
});

test('a product page is its own schema.org Product, sold by the shop, one offer per variant', async () => {
  const { productJsonLd } = await import('../src/core/discovery.ts');
  const mug = demoCatalog.products[0];
  const data = productJsonLd(demoCatalog, mug, site) as { '@type': string; url: string; image: string; brand: { name: string }; offers: { name: string; url: string }[] };
  assert.equal(data['@type'], 'Product');
  assert.equal(data.url, site.productPage(demoCatalog.shop.slug, mug.id));
  assert.equal(data.image, `https://sayso.example${mug.imageUrl}`, 'a photo on this site becomes a full URL');
  assert.equal(data.brand.name, demoCatalog.shop.name);
  assert.deepEqual(data.offers.map((o) => o.name), mug.variants.map((v) => v.title));
});

test('stock reads in plain words, and the example prompt asks for something the shop can sell', async () => {
  const { assistantPrompt, stockNote } = await import('../src/core/storefront.ts');
  const [speckled, sage, midnight] = demoCatalog.products[0].variants;
  const vase = demoCatalog.products[2].variants[0];
  assert.deepEqual([stockNote(speckled).text, stockNote(sage).text, stockNote(midnight).text, stockNote(vase).text], ['Last one', '6 in stock', 'Sold out', 'Made to order, about 10 days']);
  assert.equal(assistantPrompt(demoCatalog), 'Buy a Sage Green Hand-thrown Mug from Maya Ceramics on Sayso and ship it to me.');
  assert.equal(assistantPrompt(demoCatalog, demoCatalog.products[1]), 'Buy a Sand Ramen Bowl from Maya Ceramics on Sayso and ship it to me.');
});
