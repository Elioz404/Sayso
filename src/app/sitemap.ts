// Every public page and listed shop, for search engines and shopping crawlers.
import type { MetadataRoute } from 'next';
import { ready } from '@/server/context.ts';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { catalogs, links } = await ready();
  const pages = ['', '/start', '/tour', '/docs', '/llms.txt'].map((path) => ({ url: `${links.base}${path}` }));
  const shops = (await catalogs.listLive()).map(({ shop }) => ({ url: links.shopPage(shop.slug) }));
  return [...pages, ...shops];
}
