// The owner edits one variant from the catalog grid: PATCH { "price"?: "24.00", "stock"?: 5 }.
// Same service as the agent's update_variant tool, so both follow the same checks.
import { variantRow } from '@/core/catalog-view.ts';
import { HttpError } from '@/core/errors.ts';
import { parseAmount } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

// Amounts travel as text ("24.00"), never as JSON numbers, so nothing is rounded on the way.
const PATCH_VARIANT = { type: 'object', properties: { price: { type: 'string', maxLength: 20 }, stock: { type: 'integer', minimum: 0, maximum: 100_000 } } } as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { id } = await params;
    const body = await readBody(request, PATCH_VARIANT);
    const { shops } = await ready();
    const { shop } = await shops.get(shopId);

    const price = body.price !== undefined ? parseAmount(body.price, shop.currency) : undefined;
    if (body.price !== undefined && !price) throw new HttpError(400, `Price must be text like "24.00" (${shop.currency}), more than zero`);
    if (price === undefined && body.stock === undefined) throw new HttpError(400, 'Send a price, a stock count or both');

    const catalog = await shops.setVariant(shopId, id, { price, inventory: body.stock });
    return Response.json(variantRow(catalog, id));
  });
}
