// POST /merchant-cart/{cartId}/checkout: the buyer approved in PayPal; authorize, then capture via Guard.
import type { PayPalCart } from '@/core/cart/spec.ts';
import { ctx } from '@/server/context.ts';
import { assertCallerAllowed, handle, readJson } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; cartId: string }> }) {
  return handle(async () => {
    assertCallerAllowed(request);
    const { cartId } = await params;
    const body = await readJson<PayPalCart>(request);
    return Response.json(await ctx().commerce.checkout(cartId, body));
  });
}
