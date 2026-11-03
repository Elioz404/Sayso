// Running a shop day to day: orders, refunds, tracking, the say-so queue and the policy. The owner's
// agent (via MCP or the CLI) and the owner's dashboard both call this. Anything that moves money or
// changes the rules is submitted to Guard; only `decide()` approves, and only the owner reaches it.

import { draftPolicy } from './ai/policy-draft.ts';
import { LlmError, type ChatModel } from './ai/llm.ts';
import { verifyAuditChain, type Guard } from './guard/engine.ts';
import { defaultMerchantPolicy, type Policy } from './guard/policy.ts';
import { describeRule, type PolicyStore } from './guard/policy-store.ts';
import type { Actor, GuardRecord, GuardStore } from './guard/types.ts';
import { HttpError, type CartStore, type Commerce, type StoredCart } from './commerce.ts';
import type { Catalog } from './catalog.ts';
import { formatMoney, toMinor } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { addTracking } from './paypal/orders.ts';
import type { Shops } from './shops.ts';

export interface SellerDeps {
  carts: CartStore;
  guard: Guard;
  guardStore: GuardStore;
  policies: PolicyStore;
  commerce: Commerce;
  shops: Shops;
  paypal: PayPalClient;
  model?: ChatModel;
}

export interface OrderSummary {
  id: string;
  number?: string;
  status: 'awaiting_buyer' | 'needs_info' | 'paid' | 'awaiting_owner' | 'released';
  total?: string;
  items: { name?: string; variant_id?: string; quantity: number }[];
  buyer?: string;
  channel?: string;
  tracking?: StoredCart['tracking'];
  createdAt: string;
}

export class Seller {
  private readonly deps: SellerDeps;

  constructor(deps: SellerDeps) {
    this.deps = deps;
  }

  async orders(shopId: string, filter?: OrderSummary['status']): Promise<OrderSummary[]> {
    const carts = await this.deps.carts.listByShop(shopId);
    return carts.map(summarize).filter((o) => !filter || o.status === filter);
  }

  async order(shopId: string, cartId: string): Promise<{ order: OrderSummary; cart: StoredCart; records: GuardRecord[] }> {
    const cart = await this.cart(shopId, cartId);
    const records = (await this.deps.guardStore.listSince(shopId, new Date(0))).filter((r) => r.action.params?.cartId === cartId);
    return { order: summarize(cart), cart, records };
  }

  /** Refund all or part of a paid order. Goes through Guard: may run now, wait for the owner, or be denied. */
  async refund(shopId: string, cartId: string, input: { amount?: string; reason: string }, actor: Actor): Promise<GuardRecord> {
    const cart = await this.cart(shopId, cartId);
    if (!cart.captureId || !cart.orderId) throw new HttpError(422, 'This order has not been charged, so there is nothing to refund');
    const currency = cart.cart.totals?.total.currency_code ?? 'USD';
    let amount: number | undefined;
    if (input.amount !== undefined) {
      try {
        amount = toMinor({ currency_code: currency, value: input.amount });
      } catch {
        throw new HttpError(400, `Amount must look like 12.50 (${currency})`);
      }
    }
    return this.deps.guard.submit({
      kind: 'refund.create',
      actor,
      ownerId: shopId,
      amount,
      currency,
      counterparty: cart.cart.customer?.email_address,
      resourceId: cart.captureId,
      reason: input.reason.slice(0, 300) || 'Refund',
      params: { orderId: cart.orderId, cartId },
    });
  }

  /** Not a money movement, so no Guard round-trip; still idempotent per order + tracking number. */
  async addTracking(shopId: string, cartId: string, carrier: string, trackingNumber: string): Promise<OrderSummary> {
    const cart = await this.cart(shopId, cartId);
    if (!cart.captureId || !cart.orderId) throw new HttpError(422, 'Tracking can be added once the order is paid');
    await addTracking(this.deps.paypal, cart.orderId, { captureId: cart.captureId, trackingNumber, carrier: carrier.toUpperCase() }, `${cart.id}-track-${trackingNumber}`);
    cart.tracking = { carrier: carrier.toUpperCase(), number: trackingNumber, addedAt: new Date().toISOString() };
    await this.deps.carts.put(cart);
    return summarize(cart);
  }

  async approvals(shopId: string): Promise<GuardRecord[]> {
    return (await this.deps.guardStore.listSince(shopId, new Date(0))).filter((r) => r.status === 'pending_approval');
  }

  async audit(shopId: string, limit = 50): Promise<(GuardRecord & { chainIntact: boolean })[]> {
    const records = await this.deps.guardStore.listSince(shopId, new Date(0));
    return records.slice(0, limit).map((r) => ({ ...r, chainIntact: verifyAuditChain(r) }));
  }

  async policy(shopId: string): Promise<Policy> {
    return (await this.deps.policies.get(shopId)) ?? defaultMerchantPolicy(shopId);
  }

  async describePolicy(shopId: string, currency: string): Promise<{ source?: string; rules: string[] }> {
    const policy = await this.policy(shopId);
    return { source: policy.source, rules: policy.rules.map((r) => describeRule(r, currency)) };
  }

  /** Draft rules from the owner's words and submit them. From an agent this always waits for the owner. */
  async proposePolicy(shopId: string, text: string, actor: Actor, currency: string): Promise<{ record: GuardRecord; unclear: string[] }> {
    if (!this.deps.model) throw new HttpError(503, 'Policy drafting needs an AI key (OPENAI_API_KEY or DEEPSEEK_API_KEY) on the server');
    const { policy, unclear } = await draftPolicy(this.deps.model, shopId, text, currency).catch((err: unknown) => {
      if (err instanceof LlmError && err.status === 429) throw new HttpError(429, err.message);
      if (err instanceof LlmError) throw new HttpError(502, 'The AI service failed; please try again in a minute');
      throw new HttpError(422, err instanceof Error ? err.message : 'Could not draft that policy');
    });
    const record = await this.deps.guard.submit({
      kind: 'policy.update',
      actor,
      ownerId: shopId,
      reason: `New rules: "${text.slice(0, 200)}"`,
      params: { policy, currency },
    });
    return { record, unclear };
  }

  /** The owner's say-so. Callers must have authenticated the owner of `shopId`. */
  async decide(shopId: string, recordId: string, decision: 'approve' | 'reject', approver: string, note?: string): Promise<GuardRecord> {
    const record = await this.deps.guardStore.get(recordId);
    if (!record || record.action.ownerId !== shopId) throw new HttpError(404, `No say-so request ${recordId} for this shop`);
    if (!approver.startsWith('owner:')) throw new HttpError(403, 'Only the owner can decide');

    try {
      if (decision === 'approve') {
        const done = await this.deps.guard.approve(recordId, approver);
        await this.deps.commerce.applyRecord(done);
        return done;
      }
      const rejected = await this.deps.guard.reject(recordId, approver, note);
      // A rejected capture must not leave the buyer's money on hold.
      if (rejected.action.kind === 'payment.capture' && rejected.action.resourceId) {
        const released = await this.deps.guard.submit({
          kind: 'payment.void',
          actor: { type: 'human', id: approver, side: 'merchant' },
          ownerId: shopId,
          resourceId: rejected.action.resourceId,
          reason: `Owner rejected the capture${note ? `: ${note}` : ''}.`,
          params: { cartId: rejected.action.params?.cartId },
        });
        await this.deps.commerce.applyRecord(released);
      }
      return rejected;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(409, err instanceof Error ? err.message : 'Could not decide');
    }
  }

  /** What agents tried to buy and couldn't: the demand a seller is missing. */
  async missedDemand(shopId: string): Promise<{ variant_id?: string; code: string; message: string; at: string }[]> {
    const carts = await this.deps.carts.listByShop(shopId);
    return carts.flatMap((c) =>
      (c.cart.validation_issues ?? [])
        .filter((i) => i.code === 'INVENTORY_ISSUE' || i.code === 'DATA_ERROR' || i.code === 'SHIPPING_ERROR' || i.code === 'BUSINESS_RULE_ERROR')
        .map((i) => ({ variant_id: i.variant_id, code: i.code, message: i.user_message ?? i.message, at: c.updatedAt })),
    );
  }

  private async cart(shopId: string, cartId: string): Promise<StoredCart> {
    const cart = await this.deps.carts.get(cartId);
    if (!cart || cart.shopId !== shopId) throw new HttpError(404, `No order ${cartId} in this shop`);
    return cart;
  }
}

function summarize(c: StoredCart): OrderSummary {
  const total = c.cart.totals ? formatMoney(toMinor(c.cart.totals.total), c.cart.totals.total.currency_code) : undefined;
  const status: OrderSummary['status'] =
    c.cart.status === 'COMPLETED'
      ? c.voided
        ? 'released'
        : c.captureId
          ? 'paid'
          : 'awaiting_owner'
      : c.cart.validation_status === 'VALID'
        ? 'awaiting_buyer'
        : 'needs_info';
  return {
    id: c.id,
    number: c.merchantOrderNumber,
    status,
    total,
    items: c.cart.items.map((i) => ({ name: i.name, variant_id: i.variant_id, quantity: i.quantity })),
    buyer: c.cart.customer?.email_address,
    channel: c.channel,
    tracking: c.tracking,
    createdAt: c.createdAt,
  };
}

/** Plain catalog view for agents: what's for sale, at what price, how many. */
export function catalogView(catalog: Catalog) {
  const { shop } = catalog;
  return {
    shop: { slug: shop.slug, name: shop.name, currency: shop.currency, ships_from: shop.country, status: shop.status ?? 'live' },
    products: catalog.products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      category: p.category,
      variants: p.variants.map((v) => ({
        variant_id: v.id,
        title: v.title,
        price: formatMoney(v.price, shop.currency),
        in_stock: v.madeToOrderDays !== undefined ? 'made to order' : v.inventory,
      })),
    })),
    shipping: shop.shipping.map((s) => ({ name: s.name, to: s.countries.join(', '), price: formatMoney(s.price, shop.currency), days: `${s.minDays}-${s.maxDays}` })),
  };
}
