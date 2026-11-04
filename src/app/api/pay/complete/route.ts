// POST { cart, token } after the buyer approved in PayPal's own button (the shopping assistant): the same
// completion as the return page PayPal redirects to. Stock is re-checked, then Guard authorizes and captures.
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';
import { limitPayPal } from '@/server/rate-limit.ts';

const APPROVED = {
  type: 'object',
  properties: { cart: { type: 'string', minLength: 1, maxLength: 60 }, token: { type: 'string', minLength: 1, maxLength: 60 } },
  required: ['cart', 'token'],
} as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    limitPayPal(request);
    const { cart, token } = await readBody(request, APPROVED);
    const result = await (await ready()).commerce.checkout(cart, { items: [], payment_method: { type: 'paypal', token } });
    return Response.json({
      order: result.payment_confirmation?.merchant_order_number,
      status: result.payment_confirmation?.payment_status,
      total: result.totals?.total,
    });
  });
}
