// Shared loaders for the owner area. Each is cached per request, so the layout and the page that both
// need the shop (or the waiting list) read it once.
import 'server-only';
import { cache } from 'react';
import { maskPersonalData } from '@/core/privacy.ts';
import { ready } from './context.ts';
import { ownerSession } from './http.ts';

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
