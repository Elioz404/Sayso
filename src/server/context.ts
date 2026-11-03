// Server-side wiring: one PayPal client, the stores, Guard and the services on top of it, shared by
// every route. Postgres when DATABASE_URL is set (Render), in-memory otherwise. Kept on globalThis so
// Next.js dev hot-reloads don't reset state mid-demo. Always reach it through `await ready()`.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Access, MemoryAccessStore, type AccessStore } from '@/core/access.ts';
import { modelFromEnv, type Budget, type ChatModel } from '@/core/ai/llm.ts';
import { Commerce } from '@/core/commerce.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { Guard, MemoryGuardStore } from '@/core/guard/engine.ts';
import { defaultMerchantPolicy } from '@/core/guard/policy.ts';
import { MemoryPolicyStore, policyUpdateExecutor, type PolicyStore } from '@/core/guard/policy-store.ts';
import type { GuardStore } from '@/core/guard/types.ts';
import { Invoicing } from '@/core/invoicing.ts';
import { Channel3 } from '@/core/channel3.ts';
import { links, type Links } from '@/core/links.ts';
import { MarketPrices } from '@/core/market.ts';
import { Orders } from '@/core/orders.ts';
import { Payouts } from '@/core/payouts.ts';
import { PayPalClient } from '@/core/paypal/client.ts';
import { MemoryJobStore, Production, type JobStore } from '@/core/production.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '@/core/paypal/executors.ts';
import { invoiceExecutor } from '@/core/paypal/invoices.ts';
import { policyLookup } from '@/core/policies.ts';
import { SaySo } from '@/core/say-so.ts';
import { MemorySellerStore, Sellers } from '@/core/sellers.ts';
import { MemoryTourStore, Tours } from '@/core/tour.ts';
import { Shops } from '@/core/shops.ts';
import { MemoryCartStore, MemoryCatalogStore, type CartStore, type CatalogStore } from '@/core/stores.ts';
import type { ToolServices } from '@/core/tools/registry.ts';
import { MemoryWalletStore, walletCheckoutExecutor, Wallets, type WalletStore } from '@/core/wallets.ts';
import { notifyOwner } from './notify.ts';
import { Db, PgAccessStore, PgCartStore, PgCatalogStore, PgGuardStore, PgJobStore, PgPolicyStore, PgSellerStore, PgTourStore, PgWalletStore } from './pg-stores.ts';

export interface Context {
  carts: CartStore;
  catalogs: CatalogStore;
  access: Access;
  model?: ChatModel;
  aiBudget?: Budget;
  guard: Guard;
  commerce: Commerce;
  shops: Shops;
  sellers: Sellers;
  payouts: Payouts;
  paypal: PayPalClient;
  /** Owners sign in with PayPal (Log in with PayPal is set up on the PayPal app): PAYPAL_LOGIN=true. */
  paypalLogin: boolean;
  orders: Orders;
  saySo: SaySo;
  invoicing: Invoicing;
  wallets: Wallets;
  production: Production;
  /** The judges' tour; only on servers that run the public demo (SAYSO_DEMO=true). */
  tours?: Tours;
  market?: MarketPrices;
  tools: ToolServices;
  links: Links;
}

const globalForSayso = globalThis as unknown as { sayso?: Promise<Context> };

/** Every public URL, from PUBLIC_BASE_URL. Safe to call without the database (static pages use it). */
export function siteLinks(): Links {
  return links(process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000');
}

/** Owners sign in with PayPal on this deployment (Log in with PayPal is set up on the PayPal app). */
export function paypalLoginEnabled(): boolean {
  return process.env.PAYPAL_LOGIN === 'true';
}

/** Whether the APIMatic developer portal was generated into public/developers for this deployment. */
export function developerPortalBuilt(): boolean {
  return existsSync(join(process.cwd(), 'public', 'developers', 'index.html'));
}

/** The shared context, created (and the database migrated and seeded) on first use. */
export function ready(): Promise<Context> {
  globalForSayso.sayso ??= create().catch((err) => {
    globalForSayso.sayso = undefined; // let the next request retry, e.g. after the database wakes up
    throw err;
  });
  return globalForSayso.sayso;
}

async function create(): Promise<Context> {
  const paypal = PayPalClient.fromEnv();
  const db = process.env.DATABASE_URL ? new Db(process.env.DATABASE_URL) : undefined;
  await db?.migrate();

  const carts: CartStore = db ? new PgCartStore(db) : new MemoryCartStore();
  const catalogs: CatalogStore = db ? new PgCatalogStore(db) : new MemoryCatalogStore();
  const guardStore: GuardStore = db ? new PgGuardStore(db) : new MemoryGuardStore();
  const policies: PolicyStore = db ? new PgPolicyStore(db) : new MemoryPolicyStore();
  const accessStore: AccessStore = db ? new PgAccessStore(db) : new MemoryAccessStore();
  const walletStore: WalletStore = db ? new PgWalletStore(db) : new MemoryWalletStore();
  const jobs: JobStore = db ? new PgJobStore(db) : new MemoryJobStore();
  const access = new Access(accessStore, sessionSecret());
  const ai = modelFromEnv();
  const model = ai?.model;
  const site = siteLinks();
  const policyFor = policyLookup(policies, catalogs);
  const payouts = new Payouts({ paypal, catalogs, links: site, partnerMerchantId: process.env.PAYPAL_PARTNER_MERCHANT_ID || undefined });

  const guard = new Guard({
    store: guardStore,
    executors: {
      'payment.capture': captureExecutor(paypal),
      'payment.void': voidExecutor(paypal),
      'refund.create': refundExecutor(paypal, (shopId) => payouts.merchantFor(shopId)),
      'policy.update': policyUpdateExecutor(policies, policyFor),
      'invoice.send': invoiceExecutor(paypal),
    },
    policyFor,
    onApprovalNeeded: (record) => notifyOwner(record, site.approve(record.id)),
  });
  const commerce = new Commerce({ paypal, carts, catalogs, guard, links: site });
  // A buyer's saved-PayPal purchase goes through the buyer's own Guard (their limits) and needs Commerce.
  guard.register('checkout.create', walletCheckoutExecutor({ commerce, store: walletStore, paypal }));

  const shops = new Shops({ catalogs, access, paypal, model, links: site });
  const sellers = new Sellers({ store: db ? new PgSellerStore(db) : new MemorySellerStore(), catalogs });
  const orders = new Orders({ carts, guard, paypal });
  const saySo = new SaySo({ guard, policyFor, shops, model });
  const invoicing = new Invoicing({ guard, carts, shops, paypal });
  const production = new Production({ carts, catalogs, guard, invoicing, jobs });
  const wallets = new Wallets({ store: walletStore, policies, guard, commerce, paypal, links: site });
  const channel3 = Channel3.fromEnv();
  const market = channel3 && new MarketPrices(channel3);
  const tools: ToolServices = { commerce, orders, saySo, invoicing, production, shops, catalogs, wallets, links: site, market };

  // Tours copy the demo shop. SAYSO_TOUR_WALLET names a connected wallet whose PayPal approval the tour's
  // buyer assistant may pay with; without it the tour hands out PayPal links instead.
  const tours =
    process.env.SAYSO_DEMO === 'true'
      ? new Tours({
          store: db ? new PgTourStore(db) : new MemoryTourStore(),
          catalogs,
          access,
          wallets,
          saySo,
          tools,
          template: demoCatalog,
          lendFrom: process.env.SAYSO_TOUR_WALLET || undefined,
        })
      : undefined;

  await seedDemo(catalogs, policies, access);
  const paypalLogin = paypalLoginEnabled();
  return { carts, catalogs, access, model, aiBudget: ai?.budget, guard, commerce, shops, sellers, payouts, paypal, paypalLogin, orders, saySo, invoicing, production, tours, wallets, market, tools, links: site };
}

function sessionSecret(): string {
  if (process.env.SAYSO_SECRET) return process.env.SAYSO_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('SAYSO_SECRET must be set in production');
  // Dev only: owner sessions just won't survive a restart.
  return randomBytes(32).toString('hex');
}

/**
 * The demo shop (Maya Ceramics) always exists. SAYSO_RESET_DEMO=true restores its stock and rules on
 * boot, for recording the video. Its credentials come from the environment so the hosted demo and the
 * judges' instructions agree; without them, random ones are printed once to the server log. Existing
 * credentials are never rotated on a normal boot.
 */
async function seedDemo(catalogs: CatalogStore, policies: PolicyStore, access: Access): Promise<void> {
  const { shop } = demoCatalog;
  const reset = process.env.SAYSO_RESET_DEMO === 'true';
  if (reset || !(await catalogs.byShopId(shop.id))) await catalogs.save(structuredClone(demoCatalog));
  if (reset) await policies.put(defaultMerchantPolicy(shop.id, shop.currency));

  const ownerSecret = process.env.SAYSO_DEMO_OWNER_SECRET || undefined;
  if (ownerSecret ? !(await access.checkOwnerSecret(shop.id, ownerSecret)) : !(await access.hasOwner(shop.id))) {
    const secret = await access.createOwner(shop.id, ownerSecret);
    if (!ownerSecret) console.log(`[sayso] demo shop owner secret: ${secret}`);
  }

  const agentSecret = process.env.SAYSO_DEMO_AGENT_KEY || undefined;
  if (agentSecret) await access.ensureAgentKey(shop.id, 'demo agent', agentSecret);
  else if (!(await access.listKeys(shop.id)).some((k) => !k.revokedAt)) {
    const { secret } = await access.createAgentKey(shop.id, 'demo agent');
    console.log(`[sayso] demo shop agent key: ${secret}`);
  }
}
