// The site's own shopping assistant. POST { messages, text } -> { messages, steps }: the browser keeps the
// conversation; each turn runs the buyer tools on the all-shops endpoint, exactly as an outside assistant
// would over MCP, under the same per-address limits.
import { cleanHistory, shopperTurn } from '@/core/ai/shopper.ts';
import { LlmError } from '@/core/ai/llm.ts';
import { ConfigError, fromLlmError, HttpError } from '@/core/errors.ts';
import { callTool, ToolError, toolsFor, type ToolContext } from '@/core/tools/registry.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';
import { clientAddress, costlyCalls } from '@/server/rate-limit.ts';

const TURN = {
  type: 'object',
  properties: { messages: { type: 'array', maxItems: 80, items: { type: 'object', properties: {} } }, text: { type: 'string', minLength: 1, maxLength: 600 } },
  required: ['text'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { messages, text } = await readBody(request, TURN, 256 * 1024);
    const caller = clientAddress(request);
    if (!costlyCalls.ai.allow(caller)) throw new HttpError(429, "That's a lot of messages from here for one hour; try again in a few minutes.");
    const { model, tools } = await ready();
    if (!model?.chat) throw new ConfigError('The shopping assistant needs an AI key on this server (OPENAI_API_KEY or DEEPSEEK_API_KEY).');

    const ctx: ToolContext = { services: tools, marketplace: true, channel: 'sayso-assistant', allow: (cost) => costlyCalls[cost].allow(caller) };
    const run = async (name: string, args: unknown) => {
      try {
        return { isError: false, result: await callTool(name, args, ctx) };
      } catch (err) {
        if (err instanceof ToolError) return { isError: true, result: err.message };
        throw err;
      }
    };
    const turn = await shopperTurn({ model, tools: toolsFor(ctx), run }, cleanHistory(messages), text).catch((err: unknown) => {
      throw err instanceof LlmError ? fromLlmError(err, 'The assistant failed') : err;
    });
    return Response.json(turn);
  });
}
