// Owner sign-in: POST { "shop": "<slug>", "secret": "sk_owner_..." } sets a signed, httpOnly session
// cookie. POST { "shop": "<slug>", "paypal": true } switches to another shop of the seller signed in with
// PayPal. POST { "demo": true } opens the shared demo shop where the server runs the public demo.
// DELETE signs this browser out; DELETE { "everywhere": true } ends every session of the shop.
import { cookies } from 'next/headers';
import { HttpError } from '@/core/errors.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { demoEnabled, ready } from '@/server/context.ts';
import { assertSameOrigin, handle, OWNER_COOKIE, readBody, requireOwnShop, startOwnerSession } from '@/server/http.ts';
import { endSellerSession, sellerId } from '@/server/seller-session.ts';

const SIGN_IN = {
  type: 'object',
  properties: { shop: { type: 'string', maxLength: 80 }, secret: { type: 'string', maxLength: 100 }, demo: { type: 'boolean' }, paypal: { type: 'boolean' } },
} as const;
const SIGN_OUT = { type: 'object', properties: { everywhere: { type: 'boolean' } } } as const;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { shop, secret, demo, paypal } = await readBody(request, SIGN_IN);
    const { access, catalogs, sellers } = await ready();

    if (demo && demoEnabled()) {
      await startOwnerSession(demoCatalog.shop.id, { kind: 'demo' });
      return Response.json({ ok: true });
    }
    const catalog = shop ? await catalogs.bySlug(shop.trim()) : undefined;
    if (!catalog) throw new HttpError(401, 'Shop or owner secret is wrong');
    const seller = paypal ? await sellerId() : undefined;
    if (seller && (await sellers.owns(seller, catalog.shop.id))) {
      // Switching shops rides an earlier PayPal sign-in, so it isn't a fresh one.
      await startOwnerSession(catalog.shop.id, { via: 'switch' });
    } else if (secret && (await access.checkOwnerSecret(catalog.shop.id, secret.trim()))) {
      await startOwnerSession(catalog.shop.id);
    } else {
      throw new HttpError(401, 'Shop or owner secret is wrong');
    }
    return Response.json({ ok: true });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { everywhere } = await readBody(request, SIGN_OUT);
    if (everywhere) await (await ready()).access.signOutEverywhere((await requireOwnShop(request)).shopId);
    (await cookies()).delete(OWNER_COOKIE);
    await endSellerSession();
    return Response.json({ ok: true });
  });
}
