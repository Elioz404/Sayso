// The whole server wired like src/server/context.ts, but on the PayPal fake and a scripted model.

import { Access, MemoryAccessStore } from '../src/core/access.ts';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { Commerce, MemoryCartStore, MemoryCatalogStore } from '../src/core/commerce.ts';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { Guard, MemoryGuardStore, type GuardDeps } from '../src/core/guard/engine.ts';
import { defaultMerchantPolicy } from '../src/core/guard/policy.ts';
import { MemoryPolicyStore, policyUpdateExecutor } from '../src/core/guard/policy-store.ts';
import { handleMcp } from '../src/core/mcp.ts';
import { PayPalClient } from '../src/core/paypal/client.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '../src/core/paypal/executors.ts';
import { invoiceExecutor } from '../src/core/paypal/invoices.ts';
import { Seller } from '../src/core/seller.ts';
import { Shops } from '../src/core/shops.ts';
import type { ToolContext, ToolServices } from '../src/core/tools/registry.ts';
import { MemoryWalletStore, walletCheckoutExecutor, Wallets } from '../src/core/wallets.ts';
import { fakePayPal } from './fake-paypal.ts';

export async function stack(model?: ChatModel) {
  const pp = fakePayPal();
  const paypal = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: pp.fetch });
  const carts = new MemoryCartStore();
  const catalogs = new MemoryCatalogStore([demoCatalog]);
  const guardStore = new MemoryGuardStore();
  const policies = new MemoryPolicyStore([defaultMerchantPolicy(demoCatalog.shop.id)]);
  const access = new Access(new MemoryAccessStore(), 'test-session-secret-0123456789');
  const approvals: string[] = [];
  const executors: GuardDeps['executors'] = {
    'payment.capture': captureExecutor(paypal),
    'payment.void': voidExecutor(paypal),
    'refund.create': refundExecutor(paypal),
    'policy.update': policyUpdateExecutor(policies, defaultMerchantPolicy),
    'invoice.send': invoiceExecutor(paypal),
  };
  const guard = new Guard({
    store: guardStore,
    executors,
    policyFor: async (ownerId) => (await policies.get(ownerId)) ?? defaultMerchantPolicy(ownerId),
    onApprovalNeeded: (r) => void approvals.push(r.id),
  });
  const commerce = new Commerce({ paypal, carts, catalogs, guard, baseUrl: 'https://sayso.test' });
  const walletStore = new MemoryWalletStore();
  executors['checkout.create'] = walletCheckoutExecutor({ commerce, store: walletStore });
  const wallets = new Wallets({ store: walletStore, policies, guard, commerce, paypal, baseUrl: 'https://sayso.test' });
  const shops = new Shops({ catalogs, access, paypal, model, baseUrl: 'https://sayso.test' });
  const seller = new Seller({ carts, guard, guardStore, policies, commerce, shops, paypal, model });
  const services: ToolServices = { commerce, seller, shops, catalogs, wallets, approvalsUrl: 'https://sayso.test/approve' };

  await access.createOwner(demoCatalog.shop.id, 'sk_owner_demo');
  const { key } = await access.createAgentKey(demoCatalog.shop.id, 'laptop', 'sk_agent_demo');

  let rpcId = 0;
  /** Call a tool the way an MCP client would; returns the parsed result and the error flag. */
  async function call(name: string, args: unknown, ctx: Partial<ToolContext>) {
    const res = (await handleMcp({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }, { services, channel: 'test', ...ctx })) as any;
    const text = res.result.content[0].text as string;
    return { isError: Boolean(res.result.isError), text, data: res.result.isError ? undefined : JSON.parse(text) };
  }

  const buyer: Partial<ToolContext> = { shopSlug: 'maya-ceramics' };
  const owner: Partial<ToolContext> = { agent: { shopId: demoCatalog.shop.id, keyId: key.id, label: key.label } };

  return { pp, paypal, carts, catalogs, guardStore, policies, access, guard, commerce, shops, seller, wallets, services, approvals, call, buyer, owner };
}

export const address = { country_code: 'US', admin_area_1: 'TX', admin_area_2: 'Austin', postal_code: '78701', address_line_1: '100 Congress Ave' };
