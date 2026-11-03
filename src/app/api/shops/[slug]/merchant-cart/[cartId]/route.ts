// GET / PUT /merchant-cart/{cartId}. PUT replaces the entire cart, per the spec. Only this shop's carts.
import type { PayPalCart } from '@/core/cart/spec.ts';
import { ready } from '@/server/context.ts';
import { handle, liveCatalog, readJson } from '@/server/http.ts';

type Params = { params: Promise<{ slug: string; cartId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { slug, cartId } = await params;
    return Response.json(await (await ready()).commerce.getCart(cartId, (await liveCatalog(slug)).shop.id));
  });
}

export async function PUT(request: Request, { params }: Params) {
  return handle(async () => {
    const { slug, cartId } = await params;
    const body = await readJson<PayPalCart>(request);
    return Response.json(await (await ready()).commerce.updateCart(cartId, body, (await liveCatalog(slug)).shop.id));
  });
}
