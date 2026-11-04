// A minimal, dependency-free MCP server over JSON-RPC: initialize, ping, tools/list, tools/call.
// Transport-agnostic: the Streamable HTTP route answers each POST with plain JSON (no SSE needed for
// request/response tools), and the CLI's `sayso mcp` bridges stdio to the same endpoint.

import { ABOUT } from './about.ts';
import { callTool, toolsFor, ToolError, type ToolContext } from './tools/registry.ts';

export const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const INSTRUCTIONS = {
  marketplace:
    "Small independent shops that sell through Sayso and get paid with PayPal. list_shops or search_products (across all shops) -> create_cart with the result's shop and variant_id (one cart per shop) -> fix validation_issues with update_cart -> give the buyer approval_url to pay with PayPal -> get_cart to confirm. Prices, shipping and tax always come from the shop. After the order, get_cart answers where it is and request_refund sends the buyer's request to the shop owner. To pay without a link each time, connect_paypal once (the buyer sets limits and approves in PayPal), then pay_with_paypal.",
  buyer:
    "Sayso shop. search_products -> create_cart -> (fix validation_issues with update_cart) -> give the buyer approval_url to pay with PayPal -> get_cart to confirm. Prices, shipping and tax always come from the shop, never from you. After the order: get_cart answers where it is (charge, refunds, tracking), and request_refund sends the buyer's refund request to the shop owner, who decides.",
  seller:
    "You are running this shop for its owner. Start with shop_overview. Refunds and rule changes go through the owner's say-so: they may wait for the owner's OK, and you can never approve them yourself. When something is pending_approval, tell the owner plainly what you asked for and why.",
};

/** Handle one JSON-RPC message. Returns undefined for notifications (no response is sent). */
export async function handleMcp(message: unknown, ctx: ToolContext): Promise<JsonRpcResponse | undefined> {
  if (Array.isArray(message)) return rpcError(null, -32600, 'Batch requests are not supported');
  const req = message as Partial<JsonRpcRequest>;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') return rpcError(null, -32600, 'Invalid JSON-RPC request');
  const isNotification = req.id === undefined;
  if (isNotification) return undefined;
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      const protocolVersion = (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_VERSIONS[0];
      const side = ctx.agent ? 'seller' : 'buyer';
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: 'sayso',
            title: ctx.agent ? 'Sayso: run my shop' : ctx.marketplace ? 'Sayso: shop small sellers' : `Sayso shop ${ctx.shopSlug ?? ''}`.trim(),
            version: ABOUT.version,
          },
          instructions: ctx.agent && ctx.shopSlug ? `${INSTRUCTIONS.seller}\n\nBuyer tools are also available.` : ctx.marketplace ? INSTRUCTIONS.marketplace : INSTRUCTIONS[side],
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: toolsFor(ctx).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
        },
      };

    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      try {
        const result = await callTool(name, req.params?.arguments, ctx);
        const structured = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : { result };
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: structured } };
      } catch (err) {
        // Tool failures are results the model can read and recover from, not protocol errors.
        const text = err instanceof ToolError ? err.message : 'The shop hit an unexpected error. Try again in a moment.';
        // The stack, not the error object: a PayPal error carries PayPal's response body, which can hold payer details.
        if (!(err instanceof ToolError)) console.error(`[mcp] ${name} failed`, err instanceof Error ? (err.stack ?? err.message) : String(err));
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
