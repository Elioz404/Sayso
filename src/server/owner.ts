// Shared loaders for the owner area. Each is cached per request, so the layout and the page that both
// need the shop (or the waiting list) read it once.
import 'server-only';
import { cache } from 'react';
import { ready } from './context.ts';
import { ownerShopId } from './http.ts';

/** The signed-in shop with every service, or undefined when nobody is signed in. */
export const ownerView = cache(async () => {
  const shopId = await ownerShopId();
  if (!shopId) return undefined;
  const context = await ready();
  const catalog = await context.shops.get(shopId).catch(() => undefined);
  if (!catalog) return undefined;
  return { shopId, catalog, shop: catalog.shop, ...context };
});

/** What waits for the owner's say-so. */
export const pendingFor = cache(async (shopId: string) => (await ready()).saySo.pending(shopId));
