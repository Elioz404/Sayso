// The owner's shipping prices: PUT { rules: [{ id, price? ("8.95"), free_above? ("75.00" | "" for none) }] }.
// Not in the shared demo.
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody, requireOwnShop } from '@/server/http.ts';

const SHIPPING = {
  type: 'object',
  properties: {
    rules: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'object', properties: { id: { type: 'string', maxLength: 80 }, price: { type: 'string', maxLength: 20 }, free_above: { type: 'string', maxLength: 20 } }, required: ['id'] },
    },
  },
  required: ['rules'],
} as const;

export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { shopId } = await requireOwnShop(request);
    const { rules } = await readBody(request, SHIPPING);
    const catalog = await (await ready()).shops.editShipping(
      shopId,
      rules.map((r) => ({ id: r.id, price: r.price, ...(r.free_above !== undefined ? { freeAbove: r.free_above } : {}) })),
    );
    return Response.json({ shipping: catalog.shop.shipping.length });
  });
}
