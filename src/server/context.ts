// Server-side wiring: one PayPal client, the stores, Guard, Commerce, Shops and Seller, shared by every
// route. Kept on globalThis so Next.js dev hot-reloads don't reset in-memory state mid-demo.

import 'server-only';
import { randomBytes } from 'node:crypto';
import { Access, MemoryAccessStore } from '@/core/access.ts';
import { modelFromEnv, type ChatModel } from '@/core/ai/llm.ts';
import { Commerce, MemoryCartStore, MemoryCatalogStore } from '@/core/commerce.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { Guard, MemoryGuardStore } from '@/core/guard/engine.ts';
import { defaultBuyerPolicy, defaultMerchantPolicy } from '@/core/guard/policy.ts';
import { MemoryPolicyStore, policyUpdateExecutor } from '@/core/guard/policy-store.ts';
import { PayPalClient } from '@/core/paypal/client.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '@/core/paypal/executors.ts';
import { Seller } from '@/core/seller.ts';
import { Shops } from '@/core/shops.ts';
import type { ToolServices } from '@/core/tools/registry.ts';
import { notifyOwner } from './notify.ts';

interface Context {
  paypal: PayPalClient;
  carts: MemoryCartStore;
  catalogs: MemoryCatalogStore;
  guardStore: MemoryGuardStore;
  policies: MemoryPolicyStore;
  access: Access;
  model?: ChatModel;
  guard: Guard;
  commerce: Commerce;
  shops: Shops;
  seller: Seller;
  tools: ToolServices;
  baseUrl: string;
}

const globalForSayso = globalThis as unknown as { sayso?: Context; saysoBoot?: Promise<void> };

export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function ctx(): Context {
  if (globalForSayso.sayso) return globalForSayso.sayso;

  const paypal = PayPalClient.fromEnv();
  const carts = new MemoryCartStore();
  const catalogs = new MemoryCatalogStore([demoCatalog]);
  const guardStore = new MemoryGuardStore();
  const policies = new MemoryPolicyStore([defaultMerchantPolicy(demoCatalog.shop.id)]);
  const access = new Access(new MemoryAccessStore(), sessionSecret());
  const model = modelFromEnv();
  const url = baseUrl();
  const fallbackPolicy = (ownerId: string) => (ownerId.startsWith('shop_') ? defaultMerchantPolicy(ownerId) : defaultBuyerPolicy(ownerId));

  const guard = new Guard({
    store: guardStore,
    executors: {
      'payment.capture': captureExecutor(paypal),
      'payment.void': voidExecutor(paypal),
      'refund.create': refundExecutor(paypal),
      'policy.update': policyUpdateExecutor(policies, fallbackPolicy),
    },
    policyFor: async (ownerId) => (await policies.get(ownerId)) ?? fallbackPolicy(ownerId),
    onApprovalNeeded: (record) => notifyOwner(record, `${url}/approve/${record.id}`),
  });

  const commerce = new Commerce({ paypal, carts, catalogs, guard, baseUrl: url });
  const shops = new Shops({ catalogs, access, paypal, model, baseUrl: url });
  const seller = new Seller({ carts, guard, guardStore, policies, commerce, shops, paypal, model });
  const tools: ToolServices = { commerce, seller, shops, catalogs, approvalsUrl: `${url}/approve` };

  globalForSayso.sayso = { paypal, carts, catalogs, guardStore, policies, access, model, guard, commerce, shops, seller, tools, baseUrl: url };
  globalForSayso.saysoBoot = bootDemoCredentials(access);
  return globalForSayso.sayso;
}

/** Waits for the demo shop's credentials to be registered (first request after a cold start). */
export async function ready(): Promise<Context> {
  const context = ctx();
  await globalForSayso.saysoBoot;
  return context;
}

function sessionSecret(): string {
  if (process.env.SAYSO_SECRET) return process.env.SAYSO_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('SAYSO_SECRET must be set in production');
  // Dev only: owner sessions just won't survive a restart.
  return randomBytes(32).toString('hex');
}

/**
 * The demo shop gets fixed credentials from the environment so the hosted demo, the video and the
 * judges' instructions agree. Without them, random ones are printed once to the server log.
 */
async function bootDemoCredentials(access: Access): Promise<void> {
  const shopId = demoCatalog.shop.id;
  const owner = await access.createOwner(shopId, process.env.SAYSO_DEMO_OWNER_SECRET || undefined);
  const { secret: agent } = await access.createAgentKey(shopId, 'demo agent', process.env.SAYSO_DEMO_AGENT_KEY || undefined);
  if (!process.env.SAYSO_DEMO_OWNER_SECRET || !process.env.SAYSO_DEMO_AGENT_KEY) {
    console.log(`[sayso] demo shop credentials for this run:\n  owner secret: ${owner}\n  agent key:    ${agent}`);
  }
}
