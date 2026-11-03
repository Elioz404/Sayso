// Server-side wiring: one PayPal client, the stores, Guard and Commerce, shared by every route.
// Kept on globalThis so Next.js dev hot-reloads don't reset in-memory state mid-demo.
// TODO(day 3): swap the memory stores for Postgres (Render) behind the same interfaces.

import 'server-only';
import { Commerce, MemoryCartStore, MemoryCatalogStore } from '@/core/commerce.ts';
import { demoCatalog } from '@/core/demo-shop.ts';
import { Guard, MemoryGuardStore } from '@/core/guard/engine.ts';
import { defaultBuyerPolicy, defaultMerchantPolicy, type Policy } from '@/core/guard/policy.ts';
import { PayPalClient } from '@/core/paypal/client.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '@/core/paypal/executors.ts';

interface Context {
  paypal: PayPalClient;
  carts: MemoryCartStore;
  catalogs: MemoryCatalogStore;
  guardStore: MemoryGuardStore;
  policies: Map<string, Policy>;
  guard: Guard;
  commerce: Commerce;
}

const globalForSayso = globalThis as unknown as { sayso?: Context };

export function ctx(): Context {
  if (globalForSayso.sayso) return globalForSayso.sayso;

  const paypal = PayPalClient.fromEnv();
  const carts = new MemoryCartStore();
  const catalogs = new MemoryCatalogStore([demoCatalog]);
  const guardStore = new MemoryGuardStore();
  const policies = new Map<string, Policy>([
    [demoCatalog.shop.id, defaultMerchantPolicy(demoCatalog.shop.id)],
  ]);

  const guard = new Guard({
    store: guardStore,
    executors: {
      'payment.capture': captureExecutor(paypal),
      'payment.void': voidExecutor(paypal),
      'refund.create': refundExecutor(paypal),
      // TODO(day 4): 'checkout.create' (buyer mandates), 'invoice.send' and 'dispute.accept'
      // via PayPal's Agent Toolkit / MCP server.
    },
    policyFor: async (ownerId) => policies.get(ownerId) ?? (ownerId.startsWith('shop_') ? defaultMerchantPolicy(ownerId) : defaultBuyerPolicy(ownerId)),
    onApprovalNeeded: (record) => {
      console.log(`[guard] ${record.id} needs the owner's say-so: ${record.decision?.hits.map((h) => h.message).join(' ')}`);
    },
  });

  const commerce = new Commerce({
    paypal,
    carts,
    catalogs,
    guard,
    baseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000',
  });

  globalForSayso.sayso = { paypal, carts, catalogs, guardStore, policies, guard, commerce };
  return globalForSayso.sayso;
}
