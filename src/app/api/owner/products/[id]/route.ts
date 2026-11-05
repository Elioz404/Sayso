// The owner edits a product on sale: PATCH { name?, description?, photo? (data URL), variants?: [{ id, title?,
// price? ("24.00"), stock?, expected_stock? (the stock the editor showed) }] }. DELETE takes it off sale for good. Not in the shared demo.
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, PHOTO_BODY_LIMIT, readBody, requireOwnShop } from '@/server/http.ts';
import { MAX_PHOTO_CHARS, MAX_STOCK } from '@/core/limits.ts';

const EDIT = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 120 },
    description: { type: 'string', maxLength: 2000 },
    photo: { type: 'string', maxLength: MAX_PHOTO_CHARS },
    variants: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        properties: { id: { type: 'string', maxLength: 80 }, title: { type: 'string', maxLength: 80 }, price: { type: 'string', maxLength: 20 }, stock: { type: 'integer', minimum: 0, maximum: MAX_STOCK }, expected_stock: { type: 'integer', minimum: 0, maximum: MAX_STOCK } },
        required: ['id'],
      },
    },
  },
} as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { shopId } = await requireOwnShop(request);
    const body = await readBody(request, EDIT, PHOTO_BODY_LIMIT);
    const catalog = await (await ready()).shops.editProduct(shopId, (await params).id, {
      name: body.name,
      description: body.description,
      photo: body.photo,
      variants: body.variants?.map((v) => ({ id: v.id, title: v.title, price: v.price, inventory: v.stock, expectedInventory: v.expected_stock })),
    });
    return Response.json({ products: catalog.products.length });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request);
    const { shopId } = await requireOwnShop(request);
    const catalog = await (await ready()).shops.removeProduct(shopId, (await params).id);
    return Response.json({ products: catalog.products.length });
  });
}
