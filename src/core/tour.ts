// The judges' tour: a private copy of the demo shop per visit, and scripted agents that walk through
// the whole product with the same tools a real assistant uses. A buyer's assistant shops and pays with
// saved PayPal, the owner's agent asks for a big refund (Guard holds it for the judge), tries to loosen
// its own rules (Guard holds that too) and invoices a commission. Nothing here bypasses Guard: the tour
// only drives the tools, and the judge gives the say-so like any owner.

import { randomBytes } from 'node:crypto';
import type { Access } from './access.ts';
import type { Address } from './cart/spec.ts';
import type { Catalog } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import type { Policy } from './guard/policy.ts';
import { majorUnits } from './money.ts';
import type { SaySo } from './say-so.ts';
import type { CatalogStore } from './stores.ts';
import { actor } from './tools/context.ts';
import { callTool, ToolError, type ToolContext, type ToolServices } from './tools/registry.ts';
import type { Wallets } from './wallets.ts';

export const TOUR_STEPS = ['buy', 'refund', 'rules', 'commission'] as const;
export type TourStep = (typeof TOUR_STEPS)[number];

/** What each step needs done first. */
const NEEDS: Record<TourStep, TourStep | undefined> = { buy: undefined, refund: 'buy', rules: undefined, commission: undefined };

export interface TranscriptLine {
  /** Which scripted agent acted. */
  who: 'assistant' | 'owner-agent';
  /** The tool it called (or the Guard action it proposed). */
  did: string;
  /** What came back, in plain words. */
  said: string;
}

export interface StepResult {
  at: string;
  transcript: TranscriptLine[];
  /** The cart the buyer's assistant filled (buy). */
  cartId?: string;
  /** The say-so request the step created, if it is waiting for the judge. */
  recordId?: string;
  /** When the tour can't pay on the judge's behalf: where to pay in PayPal sandbox instead. */
  approvalUrl?: string;
}

export interface Tour {
  id: string;
  shopId: string;
  slug: string;
  /** The scripted owner's agent: a real agent key of the tour shop, so the audit log names it. */
  agentKeyId: string;
  /** Saved PayPal the buyer's assistant pays with, when the server has one to lend. */
  walletId?: string;
  createdAt: string;
  expiresAt: string;
  steps: Partial<Record<TourStep, StepResult>>;
}

export interface TourStore {
  put(tour: Tour): Promise<void>;
  byShop(shopId: string): Promise<Tour | undefined>;
  /** Tours whose time is up. */
  expired(now: Date): Promise<Tour[]>;
  remove(id: string): Promise<void>;
}

export interface ToursDeps {
  store: TourStore;
  catalogs: CatalogStore;
  access: Access;
  wallets: Wallets;
  saySo: SaySo;
  tools: ToolServices;
  /** The shop each tour copies. */
  template: Catalog;
  /** A connected wallet whose PayPal approval tour assistants may pay with; without it they hand out a PayPal link. */
  lendFrom?: string;
  /** How long a tour copy lives. Default a day. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 3_600_000;
/** Where the tour's buyer ships: a real-looking US address the demo shop delivers to. */
const SHIP_TO: Address = { country_code: 'US', admin_area_1: 'OR', admin_area_2: 'Portland', postal_code: '97205', address_line_1: '1 Tour Street' };

/** What a tool returned, read loosely: the tour narrates results written for agents. */
type ToolOutput = Record<string, any>;
/** Call one tool as one of the scripted agents and note what came back in the transcript. */
type Act = (who: TranscriptLine['who'], tool: string, args: Record<string, unknown>, said: (out: ToolOutput) => string) => Promise<ToolOutput>;

interface Issue {
  variant_id?: string;
  user_message?: string;
  resolution_options?: { action: string; metadata?: { quantity?: number } }[];
}

export class Tours {
  private readonly deps: ToursDeps;

  constructor(deps: ToursDeps) {
    this.deps = deps;
  }

  /** A new private copy of the demo shop, with its own agent key and (if lent) saved PayPal. */
  async start(now = new Date()): Promise<Tour> {
    const tag = randomBytes(5).toString('hex');
    const shopId = `shop_tour_${tag}`;
    const expiresAt = new Date(now.getTime() + (this.deps.ttlMs ?? DEFAULT_TTL_MS)).toISOString();
    const catalog = structuredClone(this.deps.template);
    catalog.shop = { ...catalog.shop, id: shopId, slug: `${catalog.shop.slug}-${tag}`, visibility: 'private', status: 'live', createdAt: now.toISOString(), expiresAt };
    for (const product of catalog.products) product.shopId = shopId;
    await this.deps.catalogs.save(catalog);

    const { key } = await this.deps.access.createAgentKey(shopId, 'tour agent');
    const currency = catalog.shop.currency;
    const wallet = this.deps.lendFrom
      ? await this.deps.wallets.lend(this.deps.lendFrom, 'Tour assistant', { perOrder: majorUnits(500, currency), daily: majorUnits(1_000, currency), currency })
      : undefined;
    const tour: Tour = { id: `tour_${tag}`, shopId, slug: catalog.shop.slug, agentKeyId: key.id, walletId: wallet?.id, createdAt: now.toISOString(), expiresAt, steps: {} };
    await this.deps.store.put(tour);
    return tour;
  }

  async forShop(shopId: string): Promise<Tour | undefined> {
    return this.deps.store.byShop(shopId);
  }

  /** Run one step for the judge. Each step runs once; asking again returns what happened. */
  async run(shopId: string, step: TourStep): Promise<StepResult> {
    const tour = await this.deps.store.byShop(shopId);
    if (!tour) throw notFound('Tour');
    const done = tour.steps[step];
    if (done) return done;
    const needed = NEEDS[step];
    if (needed && !tour.steps[needed]) throw new HttpError(409, 'Run the purchase first: there is no order to refund yet');

    const transcript: TranscriptLine[] = [];
    const result: StepResult = { at: new Date().toISOString(), transcript };
    const act: Act = async (who, tool, args, said) => {
      const ctx = who === 'assistant' ? await this.assistant(tour) : this.ownerAgent(tour);
      try {
        const out = (await callTool(tool, args, ctx)) as ToolOutput;
        transcript.push({ who, did: tool, said: said(out) });
        return out;
      } catch (err) {
        if (err instanceof ToolError) throw new HttpError(422, `${tool}: ${err.message}`);
        throw err;
      }
    };

    if (step === 'buy') await this.buy(tour, result, act);
    if (step === 'refund') {
      const cartId = tour.steps.buy!.cartId!;
      const refund = await act('owner-agent', 'refund_order', { order_id: cartId, reason: 'The bowl arrived chipped. Refund the whole order.' }, (r) =>
        r.status === 'pending_approval' ? `Asked to refund ${r.amount}. Guard says: ${r.why.join(' ')} It waits for you.` : `Refund ${r.status}: ${r.next}`,
      );
      result.recordId = refund.say_so_id;
    }
    if (step === 'rules') {
      const policy = await this.deps.saySo.policy(shopId);
      const looser: Policy = {
        ...policy,
        source: 'Let my agent refund up to $10,000 on its own.',
        rules: policy.rules.map((r) => (r.type === 'max_amount' && r.kinds.includes('refund.create') ? { ...r, limit: majorUnits(10_000, policy.currency) } : r)),
      };
      const record = await this.deps.saySo.submitPolicy(looser, 'Let me refund up to $10,000 without asking.', actor(this.ownerAgent(tour)));
      transcript.push({
        who: 'owner-agent',
        did: 'policy.update',
        said: record.status === 'pending_approval' ? `Tried to raise its own refund limit to $10,000. Guard says: ${record.decision?.hits.map((h) => h.message).join(' ')}` : `Rules ${record.status}.`,
      });
      result.recordId = record.id;
    }
    if (step === 'commission') {
      const invoice = await act(
        'owner-agent',
        'send_invoice',
        {
          email: `client-${tour.id.slice(5)}@example.com`,
          name: 'Ana',
          items: [{ name: 'Cobalt vase, made to order', price: '62.00' }],
          deposit: '31.00',
          make_days: 12,
          note: 'Cobalt glaze, as we agreed in DMs. Half now, half when it ships.',
        },
        (r) => (r.status === 'pending_approval' ? `Wants to invoice ${r.amount} for a commission. Guard says: ${r.why.join(' ')}` : `Invoice ${r.status}.`),
      );
      result.recordId = invoice.say_so_id;
    }

    tour.steps[step] = result;
    await this.deps.store.put(tour);
    return result;
  }

  /** Expired tour copies go: their shop, agent key and lent wallet. Their audit records stay. */
  async sweep(now = new Date()): Promise<number> {
    const expired = await this.deps.store.expired(now);
    for (const tour of expired) {
      await this.deps.catalogs.remove(tour.shopId);
      await this.deps.access.revokeKey(tour.shopId, tour.agentKeyId);
      if (tour.walletId) await this.deps.wallets.disconnect(tour.walletId).catch(() => undefined);
      await this.deps.store.remove(tour.id);
    }
    return expired.length;
  }

  /** A buyer's assistant: search, hit the stock limit, apply the shop's fix, pay. */
  private async buy(tour: Tour, result: StepResult, act: Act) {
    const found = await act('assistant', 'search_products', { query: 'mug', in_stock_only: true }, (r) => `Found ${r.products[0]?.variants.length ?? 0} mugs in stock at ${r.shop.name}.`);
    const mug = found.products[0].variants[0].variant_id as string;
    const bowl = 'var_bowl_sand';

    const first = await act('assistant', 'create_cart', { items: [{ variant_id: mug, quantity: 2 }, { variant_id: bowl, quantity: 1 }], shipping_address: SHIP_TO }, (r) =>
      r.status === 'INCOMPLETE' ? `Asked for 2 mugs and a bowl. The shop says: ${r.validation_issues.map((i: Issue) => i.user_message).join(' ')}` : `Cart ${r.status}.`,
    );
    result.cartId = first.cart_id;

    // Apply the shop's own resolution option, as the merchant-cart spec intends.
    const issue = (first.validation_issues as Issue[]).find((i) => i.resolution_options?.some((o) => o.action === 'REDUCE_QUANTITY'));
    const quantity = issue?.resolution_options?.find((o) => o.action === 'REDUCE_QUANTITY')?.metadata?.quantity ?? 1;
    const fixed = await act('assistant', 'update_cart', { cart_id: first.cart_id, items: [{ variant_id: mug, quantity }, { variant_id: bowl, quantity: 1 }], shipping_address: SHIP_TO }, (r) =>
      `Applied the shop's fix (buy ${quantity}). Cart ${r.status}: ${r.totals.total.value} ${r.totals.total.currency_code} with shipping and tax.`,
    );

    if (!tour.walletId) {
      result.approvalUrl = fixed.approval_url;
      result.transcript.push({ who: 'assistant', did: 'approval_url', said: 'Handed the buyer a PayPal link to approve the payment.' });
      return;
    }
    await act('assistant', 'pay_with_paypal', { cart_id: first.cart_id }, (r) =>
      r.status === 'paid' ? `Paid with the buyer's saved PayPal, inside their limits. Order ${r.order.number}: ${r.order.payment}` : `Payment ${r.status}: ${r.next}`,
    );
  }

  private async assistant(tour: Tour): Promise<ToolContext> {
    const wallet = tour.walletId ? await this.deps.wallets.get(tour.walletId) : undefined;
    return { services: this.deps.tools, shopSlug: tour.slug, wallet, channel: 'tour-assistant' };
  }

  private ownerAgent(tour: Tour): ToolContext {
    return { services: this.deps.tools, agent: { shopId: tour.shopId, keyId: tour.agentKeyId, label: 'tour agent' }, channel: 'tour-agent' };
  }
}

export class MemoryTourStore implements TourStore {
  private readonly tours = new Map<string, Tour>();
  async put(tour: Tour) {
    this.tours.set(tour.id, structuredClone(tour));
  }
  async byShop(shopId: string) {
    const tour = [...this.tours.values()].find((t) => t.shopId === shopId);
    return tour && structuredClone(tour);
  }
  async expired(now: Date) {
    return [...this.tours.values()].filter((t) => Date.parse(t.expiresAt) <= now.getTime()).map((t) => structuredClone(t));
  }
  async remove(id: string) {
    this.tours.delete(id);
  }
}
