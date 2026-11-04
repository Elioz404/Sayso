// Every public page and listed shop, for search engines and shopping crawlers.
import type { MetadataRoute } from 'next';
import { ready } from '@/server/context.ts';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { catalogs, links } = await ready();
  const pages = ['', '/shops', '/start', '/docs', '/llms.txt'].map((path) => ({ url: `${links.base}${path}` }));
  const shops = (await catalogs.listLive()).flatMap(({ shop, products }) => [
    { url: links.shopPage(shop.slug) },
    ...products.map((p) => ({ url: links.productPage(shop.slug, p.id) })),
  ]);
  return [...pages, ...shops];
}
