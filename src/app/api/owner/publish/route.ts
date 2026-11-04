// Owner reviewed the draft: register products with PayPal and open the shop to buyer agents.
import { ready } from '@/server/context.ts';
import { handle, requireOwnShop } from '@/server/http.ts';

export async function POST(request: Request) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { catalog, warnings } = await (await ready()).shops.publish(shopId);
    return Response.json({ slug: catalog.shop.slug, status: catalog.shop.status, warnings });
  });
}
