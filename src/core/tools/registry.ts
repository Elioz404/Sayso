// One registry of tools, three doors: the MCP endpoints, the `sayso` CLI and the HTTP API all call these
// same definitions. Buyer tools are public; seller tools need the shop's agent key. Results are plain
// JSON written for an agent to read and relay to its human.

import { HttpError } from '../errors.ts';
import { buyerTools } from './buyer.ts';
import { ToolError, type Tool, type ToolContext } from './context.ts';
import { validate } from './schema.ts';
import { sellerTools } from './seller.ts';

export { ToolError, type Tool, type ToolContext, type ToolServices } from './context.ts';
export { sayso } from './views.ts';

export const TOOLS: readonly Tool[] = [...buyerTools, ...sellerTools];

/** Tools visible to this caller: buyer tools at a shop or all-shops endpoint, seller tools with a key. */
export function toolsFor(ctx: Pick<ToolContext, 'shopSlug' | 'agent' | 'marketplace'>): Tool[] {
  return TOOLS.filter((t) => {
    if (t.side === 'seller') return Boolean(ctx.agent);
    return t.marketplaceOnly ? Boolean(ctx.marketplace) : Boolean(ctx.shopSlug || ctx.marketplace);
  });
}

/** Validate, authorize and run one tool. Throws ToolError for anything the agent should fix. */
export async function callTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool "${name}"`);
  if (tool.side === 'seller' && !ctx.agent) throw new ToolError(`${name} needs the shop's agent key (Authorization: Bearer sk_agent_...)`);
  if (tool.side === 'buyer' && !toolsFor(ctx).includes(tool)) {
    throw new ToolError(tool.marketplaceOnly ? `${name} is only on the all-shops endpoint (/api/shopping/mcp)` : `${name} is a buyer tool; call it on /api/shopping/mcp or a shop's own endpoint`);
  }
  const args = input ?? {};
  const errors = validate(tool.inputSchema, args);
  if (errors.length) throw new ToolError(`Invalid arguments: ${errors.join('; ')}`);
  try {
    return await tool.run(args as Record<string, unknown>, ctx);
  } catch (err) {
    if (err instanceof HttpError) throw new ToolError(err.status >= 500 ? `Shop error: ${err.message}` : err.message);
    throw err;
  }
}
