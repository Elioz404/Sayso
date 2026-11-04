// The site's own shopping assistant. POST { messages, text } -> { messages, steps }: the browser keeps the
// conversation; each turn runs the buyer tools on the all-shops endpoint, exactly as an outside assistant
// would over MCP, under the same per-address limits.
import { cleanHistory, shopperTurn } from '@/core/ai/shopper.ts';
import { buyerOrder, buyerOrders, ordersForAssistant, type BuyerOrder } from '@/core/buyer-orders.ts';
import { LlmError } from '@/core/ai/llm.ts';
import { ConfigError, fromLlmError, HttpError } from '@/core/errors.ts';
import { callTool, ToolError, toolsFor, type ToolContext } from '@/core/tools/registry.ts';
import { buyerSession, ownsOrder, paidHere } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';
import { clientAddress, costlyCalls } from '@/server/rate-limit.ts';

const TURN = {
  type: 'object',
  properties: {
    messages: { type: 'array', maxItems: 80, items: { type: 'object', properties: {} } },
    text: { type: 'string', minLength: 1, maxLength: 600 },
    // Orders this browser paid for (their links), so "where is my order?" works without signing in.
    orders: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 60 } },
  },
  required: ['text'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { messages, text, orders: here } = await readBody(request, TURN, 256 * 1024);
    const caller = clientAddress(request);
    if (!costlyCalls.ai.allow(caller)) throw new HttpError(429, "That's a lot of messages from here for one hour; try again in a few minutes.");
    const { model, tools, carts, catalogs, orders, links } = await ready();
    if (!model?.chat) throw new ConfigError('The shopping assistant needs an AI key on this server (OPENAI_API_KEY or DEEPSEEK_API_KEY).');

    const ctx: ToolContext = { services: tools, marketplace: true, channel: 'sayso-assistant', allow: (cost) => costlyCalls[cost].allow(caller) };
    const run = async (name: string, args: unknown) => {
      if (name === 'request_refund') {
        const id = (args as { cart_id?: unknown } | null)?.cart_id;
        if (typeof id !== 'string' || !(await ownsOrder(carts, id))) {
          return { isError: true, result: 'Only the person who paid can ask for a refund here. Tell them to log in with the PayPal account that paid, on My orders, and ask again from there.' };
        }
      }
      try {
        return { isError: false, result: await callTool(name, args, ctx) };
      } catch (err) {
        if (err instanceof ToolError) return { isError: true, result: err.message };
        throw err;
      }
    };
    // The shopper's own orders: from their PayPal sign-in, and the ones this browser paid for.
    const deps = { carts, catalogs, orders, links };
    const who = await buyerSession();
    const mine = who ? await buyerOrders(deps, who) : [];
    const ids = [...new Set([...(await paidHere()), ...(here ?? [])])].filter((id) => !mine.some((o) => o.id === id)).slice(0, 10);
    const local = await Promise.all(ids.map((id) => buyerOrder(deps, id)));
    const context = ordersForAssistant([...mine, ...local.filter((o): o is BuyerOrder => Boolean(o))]);
    const turn = await shopperTurn({ model, tools: toolsFor(ctx), run }, cleanHistory(messages), text, context).catch((err: unknown) => {
      throw err instanceof LlmError ? fromLlmError(err, 'The assistant failed') : err;
    });
    return Response.json(turn);
  });
}
