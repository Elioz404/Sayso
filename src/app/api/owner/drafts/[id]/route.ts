// Put a draft on sale: POST { name?, variants: [{ id, price: "34.00", inventory }] }. DELETE discards it.
import { HttpError } from '@/core/errors.ts';
import { parseAmount } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { handle, readJson, requireOwnDevice } from '@/server/http.ts';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    const { name, variants } = await readJson<{ name?: string; variants?: { id: string; price: string; inventory: number }[] }>(request);
    const { shops } = await ready();
    const { shop } = await shops.get(shopId);
    const parsed = (Array.isArray(variants) ? variants : []).map((v) => {
      const price = parseAmount(String(v.price ?? ''), shop.currency);
      if (price === undefined) throw new HttpError(400, `"${v.price}" is not a price`);
      return { id: String(v.id), price, inventory: Math.trunc(Number(v.inventory)) };
    });
    const catalog = await shops.releaseDraft(shopId, (await params).id, parsed, typeof name === 'string' ? name : undefined);
    return Response.json({ ok: true, products: catalog.products.length });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { shopId } = await requireOwnDevice(request);
    await (await ready()).shops.discardDraft(shopId, (await params).id);
    return Response.json({ ok: true });
  });
}
