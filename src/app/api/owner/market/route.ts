// What similar items sell for elsewhere, for one of the owner's variants: GET ?variant=var_...
// Same reference the agent's price_check tool gives.
import { HttpError } from '@/core/errors.ts';
import { priceReferenceView } from '@/core/tools/views.ts';
import { ready } from '@/server/context.ts';
import { handle, ownerShopId } from '@/server/http.ts';

export async function GET(request: Request) {
  return handle(async () => {
    const shopId = await ownerShopId();
    if (!shopId) throw new HttpError(401, 'Sign in as the shop owner first');
    const variant = new URL(request.url).searchParams.get('variant');
    if (!variant) throw new HttpError(400, 'variant is required');
    const { market, shops } = await ready();
    if (!market) throw new HttpError(503, 'Market prices are not set up on this server');
    return Response.json(priceReferenceView(await market.forVariant(await shops.get(shopId), variant)));
  });
}
