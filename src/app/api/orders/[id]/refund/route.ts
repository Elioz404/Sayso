// POST /api/orders/<cart id>/refund { reason, amount? }: the buyer asks the shop for a refund from their
// order page. The same request_refund an assistant makes: it only asks, and the shop owner decides.
import { ORDER_PAGE_CHANNEL } from '@/core/buyer-orders.ts';
import { HttpError } from '@/core/errors.ts';
import { callTool, ToolError, type ToolContext } from '@/core/tools/registry.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';
import { clientAddress, costlyCalls } from '@/server/rate-limit.ts';

const ASK = {
  type: 'object',
  properties: { reason: { type: 'string', minLength: 5, maxLength: 300 }, amount: { type: 'string', maxLength: 20 } },
  required: ['reason'],
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { reason, amount } = await readBody(request, ASK);
    const caller = clientAddress(request);
    const ctx: ToolContext = { services: (await ready()).tools, marketplace: true, channel: ORDER_PAGE_CHANNEL, allow: (cost) => costlyCalls[cost].allow(caller) };
    try {
      return Response.json(await callTool('request_refund', { cart_id: (await params).id, reason, ...(amount?.trim() ? { amount: amount.trim() } : {}) }, ctx));
    } catch (err) {
      if (err instanceof ToolError) throw new HttpError(422, err.message);
      throw err;
    }
  });
}
