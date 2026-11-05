// Put a draft on sale: POST { name?, description?, variants: [{ id, price: "34.00", inventory }] }. DELETE discards it.
// Amounts travel as text so nothing is rounded on the way.
import { HttpError } from '@/core/errors.ts';
import { parseAmount } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { handle, readBody, requireOwnShop } from '@/server/http.ts';
import { MAX_STOCK } from '@/core/limits.ts';

const RELEASE = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: 120 },
    description: { type: 'string', maxLength: 2000 },
    variants: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        properties: { id: { type: 'string', maxLength: 120 }, price: { type: 'string', maxLength: 20 }, inventory: { type: 'integer', minimum: 0, maximum: MAX_STOCK } },
        required: ['id', 'price', 'inventory'],
      },
    },
  },
  required: ['variants'],
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    const { name, description, variants } = await readBody(request, RELEASE);
    const { shops } = await ready();
    const { shop } = await shops.get(shopId);
    const priced = variants.map((v) => {
      const price = parseAmount(v.price, shop.currency);
      if (price === undefined) throw new HttpError(400, `"${v.price}" is not a price`);
      return { id: v.id, price, inventory: v.inventory };
    });
    const catalog = await shops.releaseDraft(shopId, (await params).id, priced, name, description);
    return Response.json({ ok: true, products: catalog.products.length });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnShop(request);
    await (await ready()).shops.discardDraft(shopId, (await params).id);
    return Response.json({ ok: true });
  });
}
