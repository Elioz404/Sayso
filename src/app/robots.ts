// Crawlers and agents may read the public site and the buyer APIs (the shopping MCP, the shops API);
// the owner area, approvals, wallets and private APIs are not for them.
import type { MetadataRoute } from 'next';
import { siteLinks } from '@/server/context.ts';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  const { base } = siteLinks();
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/owner', '/approve/', '/wallet/', '/pay/', '/order/', '/orders', '/api/orders/', '/api/owner/', '/api/guard/', '/api/mcp', '/api/wallets/', '/api/tour', '/api/internal/'] },
    sitemap: `${base}/sitemap.xml`,
  };
}
