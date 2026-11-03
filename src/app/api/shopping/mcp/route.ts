// Any shopping assistant: buyer tools across every published shop (MCP, Streamable HTTP). No key.
import { mcpGet, mcpOptions, mcpPost } from '@/server/mcp-route.ts';

export const POST = (request: Request) => mcpPost(request, undefined, true);
export const GET = mcpGet;
export const OPTIONS = mcpOptions;
