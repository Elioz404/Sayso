// Server-side wiring: one PayPal client, the stores, Guard, Commerce, Shops and Seller, shared by every
// route. Postgres when DATABASE_URL is set (Render), in-memory otherwise. Kept on globalThis so
// Next.js dev hot-reloads don't reset state mid-demo. Always reach it through `await ready()`.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { Access, MemoryAccessStore, type AccessStore } from '@/core/access.ts';
import { modelFromEnv, type Budget, type ChatModel } from '@/core/ai/llm.ts';
import { Commerce, MemoryCartStore, MemoryCatalogStore, type CartStore, type CatalogStore } from '@/core/commerce.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { Guard, MemoryGuardStore, type GuardDeps } from '@/core/guard/engine.ts';
import { defaultBuyerPolicy, defaultMerchantPolicy } from '@/core/guard/policy.ts';
import { MemoryPolicyStore, policyUpdateExecutor, type PolicyStore } from '@/core/guard/policy-store.ts';
import type { GuardStore } from '@/core/guard/types.ts';
import { PayPalClient } from '@/core/paypal/client.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '@/core/paypal/executors.ts';
import { invoiceExecutor } from '@/core/paypal/invoices.ts';
import { Seller } from '@/core/seller.ts';
import { Shops } from '@/core/shops.ts';
import type { ToolServices } from '@/core/tools/registry.ts';
import { MemoryWalletStore, walletCheckoutExecutor, Wallets, type WalletStore } from '@/core/wallets.ts';
import { notifyOwner } from './notify.ts';
import { Db, PgAccessStore, PgCartStore, PgCatalogStore, PgGuardStore, PgPolicyStore, PgWalletStore } from './pg-stores.ts';

interface Context {
  paypal: PayPalClient;
  carts: CartStore;
  catalogs: CatalogStore;
  guardStore: GuardStore;
  policies: PolicyStore;
  access: Access;
  model?: ChatModel;
  aiBudget?: Budget;
  guard: Guard;
  commerce: Commerce;
  shops: Shops;
  seller: Seller;
  wallets: Wallets;
  tools: ToolServices;
  baseUrl: string;
}

const globalForSayso = globalThis as unknown as { sayso?: Promise<Context> };

export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
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

  const carts = db ? new PgCartStore(db) : new MemoryCartStore();
  const catalogs = db ? new PgCatalogStore(db) : new MemoryCatalogStore([]);
  const guardStore = db ? new PgGuardStore(db) : new MemoryGuardStore();
  const policies = db ? new PgPolicyStore(db) : new MemoryPolicyStore();
  const accessStore: AccessStore = db ? new PgAccessStore(db) : new MemoryAccessStore();
  const walletStore: WalletStore = db ? new PgWalletStore(db) : new MemoryWalletStore();
  const access = new Access(accessStore, sessionSecret());
  const ai = modelFromEnv();
  const model = ai?.model;
  const url = baseUrl();
  const fallbackPolicy = (ownerId: string) => (ownerId.startsWith('shop_') ? defaultMerchantPolicy(ownerId) : defaultBuyerPolicy(ownerId));

  const executors: GuardDeps['executors'] = {
    'payment.capture': captureExecutor(paypal),
    'payment.void': voidExecutor(paypal),
    'refund.create': refundExecutor(paypal),
    'policy.update': policyUpdateExecutor(policies, fallbackPolicy),
    'invoice.send': invoiceExecutor(paypal),
  };
  const guard = new Guard({
    store: guardStore,
    executors,
    policyFor: async (ownerId) => (await policies.get(ownerId)) ?? fallbackPolicy(ownerId),
    onApprovalNeeded: (record) => notifyOwner(record, `${url}/approve/${record.id}`),
  });

  const commerce = new Commerce({ paypal, carts, catalogs, guard, baseUrl: url });
  // A buyer's saved-PayPal purchase goes through the buyer's own Guard (their limits).
  executors['checkout.create'] = walletCheckoutExecutor({ commerce, store: walletStore });
  const wallets = new Wallets({ store: walletStore, policies, guard, commerce, paypal, baseUrl: url });
  const shops = new Shops({ catalogs, access, paypal, model, baseUrl: url });
  const seller = new Seller({ carts, guard, guardStore, policies, commerce, shops, paypal, model });
  const tools: ToolServices = { commerce, seller, shops, catalogs, wallets, approvalsUrl: `${url}/approve` };

  await seedDemo(catalogs, policies, access);
  return { paypal, carts, catalogs, guardStore, policies, access, model, aiBudget: ai?.budget, guard, commerce, shops, seller, wallets, tools, baseUrl: url };
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
 * judges' instructions agree; without them, random ones are printed once to the server log.
 */
async function seedDemo(catalogs: CatalogStore, policies: PolicyStore, access: Access): Promise<void> {
  const shopId = demoCatalog.shop.id;
  const reset = process.env.SAYSO_RESET_DEMO === 'true';
  if (reset || !(await catalogs.byShopId(shopId))) await catalogs.save(structuredClone(demoCatalog));
  if (reset || !(await policies.get(shopId))) await policies.put(defaultMerchantPolicy(shopId));

  const ownerSecret = process.env.SAYSO_DEMO_OWNER_SECRET || undefined;
  const agentSecret = process.env.SAYSO_DEMO_AGENT_KEY || undefined;
  const owner = await access.createOwner(shopId, ownerSecret);
  const hasKey = agentSecret ? Boolean(await access.agentFromHeader(`Bearer ${agentSecret}`)) : (await access.listKeys(shopId)).length > 0;
  const agent = hasKey ? undefined : (await access.createAgentKey(shopId, 'demo agent', agentSecret)).secret;

  if (!ownerSecret) console.log(`[sayso] demo shop owner secret for this run: ${owner}`);
  if (agent && !agentSecret) console.log(`[sayso] demo shop agent key: ${agent}`);
}
