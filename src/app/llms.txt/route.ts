// /llms.txt: a plain-text map of Sayso for language models (llmstxt.org), with every listed shop.
import { llmsText } from '@/core/discovery.ts';
import { ready } from '@/server/context.ts';

export async function GET() {
  const { catalogs, links } = await ready();
  return new Response(llmsText(links, await catalogs.listLive()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
