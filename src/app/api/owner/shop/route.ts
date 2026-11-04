// The owner's shop settings. POST { name } renames the shop (its address stays the same).
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody, requireOwnShop } from '@/server/http.ts';

const RENAME = { type: 'object', properties: { name: { type: 'string', minLength: 2, maxLength: 60 } }, required: ['name'] } as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { shopId } = await requireOwnShop(request);
    const { name } = await readBody(request, RENAME);
    const catalog = await (await ready()).shops.rename(shopId, name);
    return Response.json({ name: catalog.shop.name, slug: catalog.shop.slug });
  });
}
