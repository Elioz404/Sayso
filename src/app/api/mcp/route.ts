// The owner's agent: seller tools for the shop its key belongs to (MCP, Streamable HTTP).
import { mcpGet, mcpOptions, mcpPost } from '@/server/mcp-route.ts';

export const POST = (request: Request) => mcpPost(request);
export const GET = mcpGet;
export const OPTIONS = mcpOptions;
