// POST /merchant-cart (PayPal Agentic Commerce merchant-cart API v1), scoped per shop.
import type { PayPalCart } from '@/core/cart/spec.ts';
import { ctx } from '@/server/context.ts';
import { assertCallerAllowed, handle, readJson } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    assertCallerAllowed(request);
    const { slug } = await params;
    const body = await readJson<PayPalCart>(request);
    const channel = request.headers.get('x-sayso-channel') ?? 'paypal-platform';
    const cart = await ctx().commerce.createCart(slug, body, channel);
    return Response.json(cart, { status: 201 });
  });
}
