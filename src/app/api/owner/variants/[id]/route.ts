// The owner edits one variant from the catalog grid: PATCH { "price"?: "24.00", "stock"?: 5 }.
// Same service as the agent's update_variant tool, so both follow the same checks.
import { variantRow } from '@/core/catalog-view.ts';
import { HttpError } from '@/core/errors.ts';
import { parseAmount } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwner } from '@/server/http.ts';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const shopId = await requireOwner(request);
    const { id } = await params;
    const body = await readJson<{ price?: unknown; stock?: unknown }>(request);
    const { shops } = await ready();
    const { shop } = await shops.get(shopId);

    // Amounts travel as text ("24.00"), never as JSON numbers, so nothing is rounded on the way.
    const price = typeof body.price === 'string' ? parseAmount(body.price, shop.currency) : undefined;
    if (body.price !== undefined && !price) throw new HttpError(400, `Price must be text like "24.00" (${shop.currency}), more than zero`);
    if (body.stock !== undefined && !Number.isSafeInteger(body.stock)) throw new HttpError(400, 'Stock must be a whole number');
    if (price === undefined && body.stock === undefined) throw new HttpError(400, 'Send a price, a stock count or both');

    const catalog = await shops.setVariant(shopId, id, { price, inventory: body.stock as number | undefined });
    return Response.json(variantRow(catalog, id));
  });
}
