// Shared loader for the owner area: the signed-in shop, or undefined when nobody is signed in.
import 'server-only';
import { ready } from './context.ts';
import { ownerShopId } from './http.ts';

export async function ownerView() {
  const shopId = await ownerShopId();
  if (!shopId) return undefined;
  const context = await ready();
  const catalog = await context.shops.get(shopId).catch(() => undefined);
  if (!catalog) return undefined;
  return { shopId, catalog, shop: catalog.shop, ...context };
}

export function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
