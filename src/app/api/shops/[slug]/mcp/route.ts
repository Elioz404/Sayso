// Any shopping agent: buyer tools for one published shop (MCP, Streamable HTTP).
// With the shop's own agent key, seller tools are listed too.
import { mcpGet, mcpOptions, mcpPost } from '@/server/mcp-route.ts';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return mcpPost(request, { shopSlug: (await params).slug });
}
export const GET = mcpGet;
export const OPTIONS = mcpOptions;
