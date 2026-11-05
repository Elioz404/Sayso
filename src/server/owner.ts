// Shared loaders for the owner area. Each is cached per request, so the layout and the page that both
// need the shop (or the waiting list) read it once.
import 'server-only';
import { cache } from 'react';
import type { OwnerSession } from '@/core/access.ts';
import { HttpError } from '@/core/errors.ts';
import type { Confirmation, PasskeyProof } from '@/core/passkeys.ts';
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

/**
 * New credentials (an agent key, a phone link) come only from the device the owner signed in on, right
 * after signing in or with their passkey: an old or borrowed session can't keep minting them.
 */
export async function requireStepUp(session: OwnerSession, proof: PasskeyProof | undefined, what: Confirmation): Promise<void> {
  const { access, passkeys } = await ready();
  if (session.via === 'handoff') throw new HttpError(403, 'Do this from the device you signed in on.');
  if (proof) return passkeys.confirm(session.shopId, what, proof);
  if (await passkeys.required(session.shopId)) throw new HttpError(428, 'Confirm with your passkey (fingerprint, face or PIN)');
  if (!access.isFresh(session)) throw new HttpError(403, 'For your safety, this works for 30 minutes after you sign in. Sign out and in again.');
}
