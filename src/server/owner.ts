// Shared loaders for the owner area. Each is cached per request, so the layout and the page that both
// need the shop (or the waiting list) read it once.
import 'server-only';
import { cache } from 'react';
import { maskPersonalData } from '@/core/privacy.ts';
import { ready } from './context.ts';
import { ownerSession } from './http.ts';
import { sellerId } from './seller-session.ts';

/**
 * The signed-in shop with every service, or undefined when nobody is signed in. `redact` is what every
 * page passes buyer details through: as is for the owner, masked in the shared public demo session.
 */
export const ownerView = cache(async () => {
  const session = await ownerSession();
  if (!session) return undefined;
  const context = await ready();
  const catalog = await context.shops.get(session.shopId).catch(() => undefined);
  if (!catalog) return undefined;
  const demo = session.kind === 'demo';
  const redact = (text: string) => (demo ? maskPersonalData(text) : text);
  return { shopId: session.shopId, demo, redact, catalog, shop: catalog.shop, ...context };
});

/** What waits for the owner's say-so. */
export const pendingFor = cache(async (shopId: string) => (await ready()).saySo.pending(shopId));

/** The seller signed in with PayPal in this browser, and their shops (for switching between them). */
export const signedInSeller = cache(async () => {
  const id = await sellerId();
  if (!id) return undefined;
  const { sellers } = await ready();
  const [seller, shops] = await Promise.all([sellers.get(id), sellers.shops(id)]);
  return (
    seller && {
      id,
      email: seller.email,
      name: seller.name,
      shops: shops.map(({ shop, products }) => ({
        slug: shop.slug,
        name: shop.name,
        status: (shop.status ?? 'live') === 'live' ? ('live' as const) : ('draft' as const),
        ...(products.find((p) => p.imageUrl)?.imageUrl ? { image: products.find((p) => p.imageUrl)!.imageUrl } : {}),
        pieces: products.length,
      })),
    }
  );
});

/** Signs a rules draft between drafting it and saving it (POST /api/owner/rules/draft, then /api/owner/rules). */
export const RULES_DRAFT = 'rules-draft';
