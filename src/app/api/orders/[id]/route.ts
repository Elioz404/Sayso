// GET /api/orders/<cart id>: where a buyer's order stands, for their receipts and order page. The cart id
// is the order's link, the same key an assistant's get_cart takes; only what the buyer may see.
import { buyerOrder } from '@/core/buyer-orders.ts';
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { handle } from '@/server/http.ts';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { carts, catalogs, orders, links } = await ready();
    const order = await buyerOrder({ carts, catalogs, orders, links }, (await params).id);
    if (!order) throw new HttpError(404, 'No order here');
    return Response.json(order, { headers: { 'Cache-Control': 'no-store' } });
  });
}
