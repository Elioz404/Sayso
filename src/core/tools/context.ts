// What a tool runs with (services and who is calling), and the checks tools share: which shop a seller
// key acts for, whether a cart belongs to the endpoint's shop, which wallet pays.

import type { Catalog } from '../catalog.ts';
import type { Commerce } from '../commerce.ts';
import type { Actor } from '../guard/types.ts';
import type { Invoicing } from '../invoicing.ts';
import type { Links } from '../links.ts';
import type { MarketPrices } from '../market.ts';
import type { Orders } from '../orders.ts';
import type { Production } from '../production.ts';
import type { SaySo } from '../say-so.ts';
import type { Shops } from '../shops.ts';
import type { CatalogStore } from '../stores.ts';
import type { KeyedWallet, Wallet, Wallets } from '../wallets.ts';
import type { JsonSchema } from './schema.ts';

export interface ToolServices {
  commerce: Commerce;
  orders: Orders;
  saySo: SaySo;
  invoicing: Invoicing;
  production: Production;
  shops: Shops;
  catalogs: CatalogStore;
  wallets: Wallets;
  links: Links;
  /** Market prices from a product-search source; absent when none is configured. */
  market?: MarketPrices;
}

export interface ToolContext {
  services: ToolServices;
  /** Shop the buyer endpoint is scoped to. */
  shopSlug?: string;
  /** The all-shops buyer endpoint: tools search every published shop and take a `shop` argument. */
  marketplace?: boolean;
  /**
   * Set when an agent key was presented; seller tools act on this shop only. `shared`: a key everyone
   * trying the demo holds, so buyers' personal details are masked in what the tools return.
   */
  agent?: { shopId: string; keyId: string; label: string; shared?: boolean };
  /**
   * The transport's limiter for calls that cost real money or quota (PayPal orders, AI calls), per
   * caller. Absent in tests and the CLI's local runs.
   */
  allow?: (cost: ToolCost) => boolean;
  /** Who is calling, for the audit trail: "mcp", "cli", a client name... */
  channel: string;
  /** The buyer's saved PayPal, when the caller presented its key (header or personal URL). */
  wallet?: KeyedWallet | Wallet;
}

/** What a call spends besides our own CPU: PayPal requests on the app's credentials, or an AI call. */
export type ToolCost = 'paypal' | 'ai';

export interface Tool {
  name: string;
  title: string;
  description: string;
  side: 'buyer' | 'seller';
  /** Calls that reach PayPal or the AI are rate limited per caller. */
  cost?: ToolCost;
  /** Only on the all-shops endpoint. */
  marketplaceOnly?: boolean;
  inputSchema: Extract<JsonSchema, { type: 'object' }>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  /** Arguments are checked against inputSchema before run() is called. */
  run(input: Record<string, any>, ctx: ToolContext): Promise<unknown>;
}

/** Something the agent should fix or relay; its message is shown as is. */
export class ToolError extends Error {}

/** The shop a seller key acts for. */
export function shop(ctx: ToolContext): string {
  if (!ctx.agent) throw new ToolError('Missing agent key');
  return ctx.agent.shopId;
}

export function actor(ctx: ToolContext): Actor {
  return { type: 'agent', id: `agent:${ctx.agent?.label ?? 'unknown'}:${ctx.agent?.keyId ?? '-'}`, side: 'merchant' };
}

export function buyerActor(ctx: ToolContext): Actor {
  return { type: 'agent', id: `buyer-agent:${ctx.channel}`, side: 'buyer' };
}

/** The shop of a shop-scoped endpoint, if it is open. */
export async function liveCatalog(ctx: ToolContext): Promise<Catalog> {
  const catalog = ctx.shopSlug ? await ctx.services.catalogs.bySlug(ctx.shopSlug) : undefined;
  if (!catalog || (catalog.shop.status ?? 'live') !== 'live') throw new ToolError(`Shop ${ctx.shopSlug ?? ''} is not open`.trim());
  return catalog;
}

/** Which shop a cart belongs to; a shop's own endpoint may only see that shop's carts. */
export async function ownCart(ctx: ToolContext, cartId: string): Promise<string> {
  const shopId = await ctx.services.commerce.shopOf(cartId);
  if (!shopId) throw new ToolError(`No cart ${cartId}`);
  if (ctx.shopSlug && (await liveCatalog(ctx)).shop.id !== shopId) throw new ToolError(`No cart ${cartId} at this shop`);
  return shopId;
}

/** The wallet from the wallet_key argument, or the one the caller connected with. */
export async function walletFrom(ctx: ToolContext, given: unknown): Promise<KeyedWallet | Wallet> {
  const wallet = typeof given === 'string' && given ? await ctx.services.wallets.fromKey(given) : ctx.wallet;
  if (!wallet) throw new ToolError('Unknown wallet key. Call connect_paypal to set one up.');
  return wallet;
}

/** The shop a new cart is for: the endpoint's own, or the `shop` argument on the all-shops endpoint. */
export function shopFor(ctx: ToolContext, given: string | undefined): string {
  if (ctx.shopSlug) {
    if (given && given !== ctx.shopSlug) throw new ToolError(`This endpoint only sells ${ctx.shopSlug}; drop the shop argument.`);
    return ctx.shopSlug;
  }
  if (!given) throw new ToolError('Pass `shop` (from search_products). One cart per shop.');
  return given;
}

