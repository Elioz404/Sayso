// POST /api/orders/claim { cart, token }: the PayPal return page, once the order went through, marks this
// browser as the one that paid (a page can't set cookies itself). The PayPal order id must be the cart's.
import { HttpError } from '@/core/errors.ts';
import { rememberPaidHere } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';

const CLAIM = {
  type: 'object',
  properties: { cart: { type: 'string', minLength: 1, maxLength: 60 }, token: { type: 'string', minLength: 1, maxLength: 60 } },
  required: ['cart', 'token'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { cart, token } = await readBody(request, CLAIM);
    const stored = await (await ready()).carts.get(cart);
    if (!stored || stored.cart.status !== 'COMPLETED' || stored.orderId !== token) throw new HttpError(404, 'No order here');
    await rememberPaidHere(cart);
    return Response.json({ ok: true });
  });
}
