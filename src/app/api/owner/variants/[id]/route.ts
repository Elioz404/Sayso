// The owner edits one variant from the catalog grid: PATCH { "price"?: "24.00", "stock"?: 5, "expected_stock"?: 4 }.
// Same service as the agent's update_variant tool, so both follow the same checks. With `expected_stock`
// (the stock the grid showed), a stock edit is refused if a sale changed it meanwhile.
import { variantRow } from '@/core/catalog-view.ts';
import { MAX_STOCK } from '@/core/limits.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';

// Amounts travel as text ("24.00"), never as JSON numbers, so nothing is rounded on the way.
const STOCK = { type: 'integer', minimum: 0, maximum: MAX_STOCK } as const;
const PATCH_VARIANT = { type: 'object', properties: { price: { type: 'string', maxLength: 20 }, stock: STOCK, expected_stock: STOCK } } as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { id } = await params;
    const body = await readBody(request, PATCH_VARIANT);
    const catalog = await (await ready()).shops.setVariant(shopId, id, { price: body.price, inventory: body.stock, expectedInventory: body.expected_stock });
    return Response.json(variantRow(catalog, id));
  });
}
