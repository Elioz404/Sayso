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
