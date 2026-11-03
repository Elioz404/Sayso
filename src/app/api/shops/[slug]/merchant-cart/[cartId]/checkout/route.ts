// POST /merchant-cart/{cartId}/checkout: the buyer approved in PayPal; authorize, then capture via Guard.
import type { PayPalCart } from '@/core/cart/spec.ts';
import { ready } from '@/server/context.ts';
import { handle, liveCatalog, readJson } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; cartId: string }> }) {
  return handle(async () => {
    const { slug, cartId } = await params;
    const body = await readJson<PayPalCart>(request);
    return Response.json(await (await ready()).commerce.checkout(cartId, body, (await liveCatalog(slug)).shop.id));
  });
}
