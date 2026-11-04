// POST /merchant-cart/{cartId}/checkout: the buyer approved in PayPal; authorize, then capture via Guard.
import { ready } from '@/server/context.ts';
import { handle, liveCatalog, readJson } from '@/server/http.ts';
import { limitPayPal } from '@/server/rate-limit.ts';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; cartId: string }> }) {
  return handle(async () => {
    const { slug, cartId } = await params;
    limitPayPal(request);
    const body = await readJson(request);
    return Response.json(await (await ready()).commerce.checkout(cartId, body, (await liveCatalog(slug)).shop.id));
  });
}
