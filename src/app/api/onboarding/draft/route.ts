// PUT /api/onboarding/draft: the owner's edits to the shop this browser just drafted (names, prices,
// stock, shipping, pieces taken out), while it is still a draft. With publish: true and every price
// confirmed, the next step is signing in with PayPal, which claims the shop and publishes it at once.
import { draftView } from '@/core/catalog-view.ts';
import { HttpError } from '@/core/errors.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, readBody } from '@/server/http.ts';
import { claimedShop, forgetClaim, rememberPublish } from '@/server/seller-session.ts';

const text = (max: number) => ({ type: 'string', maxLength: max }) as const;
const EDITS = {
  type: 'object',
  properties: {
    shop_name: text(60),
    products: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        properties: {
          id: text(60),
          name: text(120),
          description: text(2000),
          remove: { type: 'boolean' },
          variants: {
            type: 'array',
            maxItems: 40,
            items: { type: 'object', properties: { id: text(60), title: text(80), price: text(20), stock: { type: 'integer', minimum: 0, maximum: 100000 } }, required: ['id'] },
          },
        },
        required: ['id'],
      },
    },
    shipping: { type: 'array', maxItems: 10, items: { type: 'object', properties: { id: text(60), price: text(20), free_above: text(20) }, required: ['id'] } },
    publish: { type: 'boolean' },
  },
} as const;

export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const shopId = await claimedShop();
    if (!shopId) throw new HttpError(401, 'This draft is no longer open in this browser. Start again to draft your shop.');
    const body = await readBody(request, EDITS);
    const { shops, paypalLogin, links, access } = await ready();
    const catalog = await shops.reviewDraft(shopId, {
      shopName: body.shop_name,
      products: body.products?.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        remove: p.remove,
        variants: p.variants?.map((v) => ({ id: v.id, title: v.title, price: v.price, inventory: v.stock })),
      })),
      shipping: body.shipping?.map((s) => ({ id: s.id, price: s.price, freeAbove: s.free_above })),
    });
    const draft = draftView(catalog);
    if (!body.publish) return Response.json({ draft });
    if (draft.to_confirm) throw new HttpError(409, `Confirm ${draft.to_confirm === 1 ? 'the last price' : `${draft.to_confirm} prices`} first`);
    // Signing in with PayPal claims the shop and publishes it; without PayPal sign-in, the owner signs in with their secret and publishes from the dashboard.
    // The browser that drafted it gets the owner secret now (a new one: a draft picked up later never saw the first).
    if (!paypalLogin) return Response.json({ draft, next: links.owner.home, owner_secret: await access.createOwner(shopId) });
    await rememberPublish(shopId);
    return Response.json({ draft, next: links.paypalSignIn });
  });
}

/** Start over: this browser lets go of the draft (it is never published, and is cleared with old drafts). */
export async function DELETE(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    await forgetClaim();
    return Response.json({ ok: true });
  });
}
