// A buyer's personal shopping URL: every shop, plus their saved PayPal (the wallet key is in the path).
import { mcpGet, mcpOptions, mcpPost } from '@/server/mcp-route.ts';

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return mcpPost(request, { marketplace: true, pathKey: (await params).key });
}
export const GET = mcpGet;
export const OPTIONS = mcpOptions;
