// The owner's assistant. POST { messages, text } -> { reply, used }. Only the owner's own session reaches
// it (the shop comes from that session, never from the request), and it reads that one shop with the
// read-only seller tools, acting as an agent so Guard stays in charge. The shared demo session may use it
// too, with buyers' details masked. The browser keeps the conversation, as text only.
import { cleanOwnerHistory, OWNER_ASSISTANT_TOOLS, ownerTurn } from '@/core/ai/owner.ts';
import { LlmError } from '@/core/ai/llm.ts';
import { ConfigError, fromLlmError, HttpError } from '@/core/errors.ts';
import { RateLimit } from '@/core/rate-limit.ts';
import { callTool, ToolError, toolsFor, type ToolContext } from '@/core/tools/registry.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnerSession } from '@/server/http.ts';
import { clientAddress, costlyCalls } from '@/server/rate-limit.ts';

const TURN = {
  type: 'object',
  properties: {
    messages: { type: 'array', maxItems: 60, items: { type: 'object', properties: {} } },
    text: { type: 'string', minLength: 1, maxLength: 800 },
  },
  required: ['text'],
} as const;

/** Turns per address per hour, checked first so a caller over it spends nothing else. */
const perAddress = new RateLimit(20, 3_600_000);
/** Turns per shop per hour: each is up to five AI calls on the server's budget. */
const perShop = new RateLimit(40, 3_600_000);
/** The shared demo shop is everyone's: each visitor gets their own share, under a larger cap for all. */
const demoAll = new RateLimit(300, 3_600_000);

export async function POST(request: Request) {
  return handle(async () => {
    const session = await requireOwnerSession(request);
    const { messages, text } = await readBody(request, TURN, 128 * 1024);
    const { model, tools, shops } = await ready();
    if (!model?.chat) throw new ConfigError('The assistant needs an AI key on this server (OPENAI_API_KEY or DEEPSEEK_API_KEY).');
    // Only well-formed questions count, and each limiter is reached only if the one before it said yes.
    const caller = clientAddress(request);
    const demo = session.kind === 'demo';
    const underLimits = perAddress.allow(caller) && (demo ? demoAll.allow(session.shopId) : perShop.allow(session.shopId));
    if (!underLimits) throw new HttpError(429, "That's a lot of questions for one hour; try again in a few minutes.");
    // The owner's shop, as an agent of it: seller tools only, scoped to this shop, masked for the shared demo.
    const ctx: ToolContext = {
      services: tools,
      agent: { shopId: session.shopId, keyId: 'owner-assistant', label: 'Shop assistant', ...(demo ? { shared: true } : {}) },
      channel: 'owner-assistant',
      allow: (cost) => costlyCalls[cost].allow(caller),
    };
    const allowed = toolsFor(ctx).filter((t) => OWNER_ASSISTANT_TOOLS.has(t.name) && t.annotations?.readOnlyHint);
    const run = async (name: string, args: unknown) => {
      if (!allowed.some((t) => t.name === name)) return { isError: true, result: `${name} is not available here.` };
      try {
        return { isError: false, result: await callTool(name, args, ctx) };
      } catch (err) {
        if (err instanceof ToolError) return { isError: true, result: err.message };
        throw err;
      }
    };

    const { shop } = await shops.get(session.shopId);
    const context = [
      `The shop: ${shop.name}. Currency: ${shop.currency}. Today is ${new Date().toISOString().slice(0, 10)} (UTC).`,
      demo ? "This is Sayso's shared demo shop, open to everyone trying Sayso; buyers' personal details are masked." : '',
    ]
      .filter(Boolean)
      .join(' ');
    const turn = await ownerTurn({ model, tools: allowed, run }, cleanOwnerHistory(messages), text, context).catch((err: unknown) => {
      throw err instanceof LlmError ? fromLlmError(err, 'The assistant failed') : err;
    });
    return Response.json(turn);
  });
}
