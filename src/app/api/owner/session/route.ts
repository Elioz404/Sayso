// Owner sign-in: POST { "shop": "<slug>", "secret": "sk_owner_..." } sets a signed, httpOnly session
// cookie. DELETE signs out. In demo mode the demo shop can be opened without its secret.
import { cookies } from 'next/headers';
import { HttpError } from '@/core/errors.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { ready } from '@/server/context.ts';
import { assertSameOrigin, handle, OWNER_COOKIE, readJson, startOwnerSession } from '@/server/http.ts';

const WEEK_MS = 7 * 86_400_000;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { shop, secret, demo } = await readJson<{ shop?: string; secret?: string; demo?: boolean }>(request);
    const { access, catalogs } = await ready();

    let shopId: string | undefined;
    let kind: 'owner' | 'demo' = 'owner';
    if (demo && process.env.SAYSO_DEMO === 'true') {
      shopId = demoCatalog.shop.id;
      kind = 'demo';
    } else {
      const catalog = shop ? await catalogs.bySlug(shop.trim()) : undefined;
      if (catalog && secret && (await access.checkOwnerSecret(catalog.shop.id, secret.trim()))) shopId = catalog.shop.id;
    }
    if (!shopId) throw new HttpError(401, 'Shop or owner secret is wrong');

    await startOwnerSession(shopId, kind, new Date(Date.now() + WEEK_MS));
    return Response.json({ ok: true });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    (await cookies()).delete(OWNER_COOKIE);
    return Response.json({ ok: true });
  });
}
