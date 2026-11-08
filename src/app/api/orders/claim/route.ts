// POST /api/orders/claim { claim }: the PayPal return page, after its visit took the payment, marks this
// browser as the one that paid (a page can't set cookies itself). The claim is signed by the server and
// short-lived; knowing an order's link or its PayPal order id is not enough.
import { HttpError } from '@/core/errors.ts';
import { PAID_CLAIM, rememberPaidHere } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';

const CLAIM = {
  type: 'object',
  properties: { claim: { type: 'string', minLength: 1, maxLength: 200 } },
  required: ['claim'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { claim } = await readBody(request, CLAIM);
    const services = await ready();
    const cart = services.access.verifyValue(PAID_CLAIM, claim);
    const stored = cart ? await services.carts.get(cart) : undefined;
    if (!cart || !stored || stored.cart.status !== 'COMPLETED') throw new HttpError(404, 'No order here');
    await rememberPaidHere(cart);
    return Response.json({ ok: true });
  });
}
