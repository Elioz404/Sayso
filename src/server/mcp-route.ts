// Streamable HTTP transport for the MCP server: every POST carries one JSON-RPC message and gets one
// JSON response (or 202 for notifications). Stateless, so it scales and survives restarts.
//
// Keys travel as `Authorization: Bearer ...` or, for clients whose connector screens take only a URL
// (as in ChatGPT), inside a personal URL: /api/mcp/<sk_agent_...> or /api/shopping/mcp/<sk_wallet_...>.
// Cookies are never read here, so an agent can't ride the owner's session.

import 'server-only';
import { handleMcp } from '@/core/mcp.ts';
import type { ToolContext } from '@/core/tools/registry.ts';
import { ready } from './context.ts';
import { channelOf, handle } from './http.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, X-Sayso-Channel',
};

export interface McpEndpoint {
  /** One shop's buyer endpoint. */
  shopSlug?: string;
  /** The all-shops buyer endpoint. Neither set: seller tools, agent key required. */
  marketplace?: boolean;
  /** A key from a personal URL path; used when no Authorization header is sent. */
  pathKey?: string;
}

const bearer = (request: Request, prefix: string) => new RegExp(`^Bearer\\s+(${prefix}[A-Za-z0-9_-]+)$`).exec(request.headers.get('authorization') ?? '')?.[1];

export async function mcpPost(request: Request, endpoint: McpEndpoint = {}): Promise<Response> {
  const { shopSlug, marketplace = false, pathKey } = endpoint;
  const response = await handle(async () => {
    const { tools, catalogs, access, wallets } = await ready();
    const agentKey = bearer(request, 'sk_agent_') ?? (pathKey?.startsWith('sk_agent_') ? pathKey : undefined);
    const key = agentKey ? await access.agentFromHeader(`Bearer ${agentKey}`) : undefined;
    if (!shopSlug && !marketplace && !key) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or revoked agent key. Use your personal MCP URL from the owner dashboard (Agents).' } },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="sayso"' } },
      );
    }

    let message: unknown;
    try {
      message = await request.json();
    } catch {
      return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
    }

    // A key only unlocks seller tools at its own shop's endpoint.
    const shop = shopSlug ? await catalogs.bySlug(shopSlug) : undefined;
    const agent = key && !marketplace && (!shopSlug || shop?.shop.id === key.shopId) ? { shopId: key.shopId, keyId: key.id, label: key.label } : undefined;
    const context: ToolContext = {
      services: tools,
      shopSlug,
      marketplace,
      agent,
      wallet: await wallets.fromKey(bearer(request, 'sk_wallet_') ?? (pathKey?.startsWith('sk_wallet_') ? pathKey : undefined)),
      channel: channelOf(request, agent ? 'owner-agent' : 'mcp'),
    };

    const reply = await handleMcp(message, context);
    return reply ? Response.json(reply) : new Response(null, { status: 202 });
  });
  for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
  return response;
}

export function mcpOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** No server-initiated stream: tools are plain request/response. */
export function mcpGet(): Response {
  return new Response('Use POST with a JSON-RPC body.', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS } });
}
