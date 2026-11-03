// Streamable HTTP transport for the MCP server: every POST carries one JSON-RPC message and gets one
// JSON response (or 202 for notifications). Stateless, so it scales and survives restarts. Auth is a
// bearer agent key only; cookies are never read here, so an agent can't ride the owner's session.

import 'server-only';
import { handleMcp } from '@/core/mcp.ts';
import type { ToolContext } from '@/core/tools/registry.ts';
import { ready } from './context.ts';
import { agentFrom, handle } from './http.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, X-Sayso-Channel',
};

/** `shopSlug`: one shop's buyer endpoint. `marketplace`: the all-shops buyer endpoint. Neither: seller tools, key required. */
export async function mcpPost(request: Request, shopSlug?: string, marketplace = false): Promise<Response> {
  const response = await handle(async () => {
    const { tools, catalogs } = await ready();
    const key = await agentFrom(request);
    if (!shopSlug && !marketplace && !key) {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or revoked agent key. Send Authorization: Bearer sk_agent_...' } },
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
      walletKey: /^Bearer\s+(sk_wallet_[A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') ?? '')?.[1],
      channel: request.headers.get('x-sayso-channel')?.slice(0, 40) || (agent ? 'owner-agent' : 'mcp'),
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
