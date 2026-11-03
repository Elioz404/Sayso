// GET / PUT /merchant-cart/{cartId}. PUT replaces the entire cart, per the spec.
import type { PayPalCart } from '@/core/cart/spec.ts';
import { ready } from '@/server/context.ts';
import { assertCallerAllowed, handle, readJson } from '@/server/http.ts';

type Params = { params: Promise<{ slug: string; cartId: string }> };

export async function GET(request: Request, { params }: Params) {
  return handle(async () => {
    assertCallerAllowed(request);
    const { cartId } = await params;
    return Response.json(await (await ready()).commerce.getCart(cartId));
  });
}

export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    assertCallerAllowed(request);
    const { cartId } = await params;
    const body = await readJson<PayPalCart>(request);
    return Response.json(await (await ready()).commerce.updateCart(cartId, body));
  });
}
