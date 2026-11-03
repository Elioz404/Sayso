// POST /merchant-cart (PayPal Agentic Commerce merchant-cart API v1), scoped per shop. Like a storefront,
// carts are public; money only moves once the buyer approves in PayPal and the shop's Guard agrees.
import type { PayPalCart } from '@/core/cart/spec.ts';
import { ready } from '@/server/context.ts';
import { channelOf, handle, readJson } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const { slug } = await params;
    const body = await readJson<PayPalCart>(request);
    const cart = await (await ready()).commerce.createCart(slug, body, channelOf(request, 'paypal-platform'));
    return Response.json(cart, { status: 201 });
  });
}
