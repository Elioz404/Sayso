// The owner's agent through a personal URL (the key is in the path), for connector screens that take
// only a URL. Revoking the key in the dashboard kills the URL.
import { mcpGet, mcpOptions, mcpPost } from '@/server/mcp-route.ts';

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return mcpPost(request, { pathKey: (await params).key });
}
export const GET = mcpGet;
export const OPTIONS = mcpOptions;
