// The whole server wired like src/server/context.ts, but on the PayPal fake and a scripted model.

import { Access, MemoryAccessStore } from '../src/core/access.ts';
import type { ChatModel } from '../src/core/ai/llm.ts';
import { Commerce } from '../src/core/commerce.ts';
import { demoCatalog } from '../src/core/demo-shop.ts';
import { Guard, MemoryGuardStore } from '../src/core/guard/engine.ts';
import { MemoryPolicyStore, policyUpdateExecutor } from '../src/core/guard/policy-store.ts';
import { Invoicing } from '../src/core/invoicing.ts';
import { links } from '../src/core/links.ts';
import { handleMcp } from '../src/core/mcp.ts';
import { Orders } from '../src/core/orders.ts';
import { MemoryPasskeyStore, Passkeys } from '../src/core/passkeys.ts';
import { Payouts } from '../src/core/payouts.ts';
import { PayPalClient } from '../src/core/paypal/client.ts';
import { captureExecutor, refundExecutor, voidExecutor } from '../src/core/paypal/executors.ts';
import { invoiceExecutor } from '../src/core/paypal/invoices.ts';
import { policyLookup } from '../src/core/policies.ts';
import { MemoryJobStore, Production } from '../src/core/production.ts';
import { SaySo } from '../src/core/say-so.ts';
import { Shops } from '../src/core/shops.ts';
import { MemoryCartStore, MemoryCatalogStore } from '../src/core/stores.ts';
import type { ToolContext, ToolServices } from '../src/core/tools/registry.ts';
import { MemoryWalletStore, walletCheckoutExecutor, Wallets } from '../src/core/wallets.ts';
import { fakePayPal } from './fake-paypal.ts';

export async function stack(model?: ChatModel) {
  const pp = fakePayPal();
  const paypal = new PayPalClient({ clientId: 'id', clientSecret: 'secret', fetch: pp.fetch });
  const carts = new MemoryCartStore();
  const catalogs = new MemoryCatalogStore([demoCatalog]);
  const guardStore = new MemoryGuardStore();
  const policies = new MemoryPolicyStore();
  const policyFor = policyLookup(policies, catalogs);
  const access = new Access(new MemoryAccessStore(), 'test-session-secret-0123456789');
  const site = links('https://sayso.test');
  const approvals: string[] = [];
  const payouts = new Payouts({ paypal, catalogs, links: site, partnerMerchantId: 'SAYSO_PARTNER' });
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
    onApprovalNeeded: (r) => void approvals.push(r.id),
  });
  const commerce = new Commerce({ paypal, carts, catalogs, guard, links: site });
  const walletStore = new MemoryWalletStore();
  guard.register('checkout.create', walletCheckoutExecutor({ commerce, store: walletStore, paypal }));
  const wallets = new Wallets({ store: walletStore, policies, guard, commerce, paypal, links: site });
  const shops = new Shops({ catalogs, access, paypal, model, links: site });
  const orders = new Orders({ carts, guard, paypal });
  const passkeys = new Passkeys({ store: new MemoryPasskeyStore(), access, origin: 'https://sayso.test' });
  const saySo = new SaySo({ guard, policyFor, shops, model, passkeys });
  const invoicing = new Invoicing({ guard, carts, shops, paypal, statusTtlMs: 0 }); // tests change PayPal state between reads
  const production = new Production({ carts, catalogs, guard, invoicing, jobs: new MemoryJobStore() });
  const services: ToolServices = { commerce, orders, saySo, invoicing, production, shops, catalogs, wallets, links: site };

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

  return { pp, paypal, passkeys, payouts, carts, catalogs, guardStore, policies, access, guard, commerce, shops, orders, saySo, invoicing, production, wallets, services, approvals, call, buyer, owner };
}

export const address = { country_code: 'US', admin_area_1: 'TX', admin_area_2: 'Austin', postal_code: '78701', address_line_1: '100 Congress Ave' };
