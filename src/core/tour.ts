// The judges' tour. A judge who opens a shop from For Judges gets scripted agents on that shop: a buyer's
// assistant buys from it with saved PayPal, and the shop's own agent asks for a refund and tries to loosen
// its rules, each held by Guard for the judge to decide. (The older tour made a private copy of the demo
// shop per visit and walked the same agents through it; that still works, and is what the tests drive.)
// The scripted agents walk through
// the whole product with the same tools a real assistant uses. A buyer's assistant shops and pays with
// saved PayPal, the owner's agent asks for a big refund (Guard holds it for the judge), invoices a
// commission, tries to loosen its own rules (Guard holds that too), and finally earns some autonomy:
// after the judge approves a few refunds like it, Sayso suggests letting the agent do those alone.
// Nothing here bypasses Guard: the tour only drives the tools, and the judge gives the say-so like any owner.

import { randomBytes } from 'node:crypto';
import type { Access } from './access.ts';
import type { Address } from './cart/spec.ts';
import type { Catalog } from './catalog.ts';
import { HttpError, notFound } from './errors.ts';
import { DEFAULT_LIMITS, type Policy } from './guard/policy.ts';
import { formatMoney, majorUnits, toMoney } from './money.ts';
import type { SaySo } from './say-so.ts';
import type { CatalogStore } from './stores.ts';
import { actor } from './tools/context.ts';
import { callTool, ToolError, type ToolContext, type ToolServices } from './tools/registry.ts';
import type { Wallets } from './wallets.ts';

export const TOUR_STEPS = ['buy', 'refund', 'commission', 'rules', 'earn'] as const;
export type TourStep = (typeof TOUR_STEPS)[number];
/** What the agents do on a shop the judge opened themselves. */
export const SELLER_STEPS = ['buy', 'refund', 'rules'] as const satisfies readonly TourStep[];
/** How long a shop opened from For Judges lives. */
export const JUDGE_SHOP_TTL_MS = 48 * 3_600_000;

/** What each step needs done first. */
const NEEDS: Record<TourStep, TourStep | undefined> = { buy: undefined, refund: 'buy', commission: undefined, rules: undefined, earn: undefined };

/**
 * The refunds the owner's agent asks for in the "earn" step, in major units: each a little over the
 * default refund rule every tour copy starts with, so each waits for the judge.
 */
const EARN_REFUNDS = [2, 6, 8].map((over) => DEFAULT_LIMITS.refundApproval + over);
/** The refund limit the owner's agent tries to give itself in the "rules" step, in major units. */
export const TOUR_ASKED_REFUND_LIMIT = 10_000;
/** Made-to-order pieces the assistant buys for the "earn" step, so its refunds have an order of their own. */
const EARN_PIECES = 3;

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
  /** Several say-so requests, when the step makes more than one ("earn"). */
  recordIds?: string[];
  /** When the tour can't pay on the judge's behalf: where to pay in PayPal sandbox instead. */
  approvalUrl?: string;
}

export interface Tour {
  id: string;
  /** copy: a private copy of the demo shop. seller: a shop the judge opened from photos. */
  kind?: 'copy' | 'seller';
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

/** Deletes everything a shop (or a wallet) left behind. Postgres implements it; without it, only the shop goes. */
export interface Housekeeping {
  forgetShop(shopId: string): Promise<void>;
  forgetWallet(walletId: string): Promise<void>;
}

export interface ToursDeps {
  store: TourStore;
  /** Clears what an expired tour left: its orders, records, keys, photos, passkeys and lent wallet. */
  housekeeping?: Housekeeping;
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

  /**
   * A shop a judge just drafted from For Judges: it closes after two days like any tour, and gets the
   * scripted agents (a key for the shop's agent, saved PayPal lent to the buyer's assistant).
   */
  async adopt(shopId: string, now = new Date()): Promise<Tour> {
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw notFound('Shop');
    const expiresAt = new Date(now.getTime() + JUDGE_SHOP_TTL_MS).toISOString();
    await this.deps.catalogs.modify(shopId, (c) => {
      c.shop.expiresAt = expiresAt;
      return true;
    });
    const { key } = await this.deps.access.createAgentKey(shopId, 'judge agent');
    const currency = catalog.shop.currency;
    // Without saved PayPal to lend (or if lending fails), the assistant hands the judge a PayPal link instead.
    const wallet = this.deps.lendFrom
      ? await this.deps.wallets.lend(this.deps.lendFrom, 'Shopping assistant', { perOrder: majorUnits(500, currency), daily: majorUnits(1_000, currency), currency }).catch(() => undefined)
      : undefined;
    const tour: Tour = { id: `tour_${randomBytes(5).toString('hex')}`, kind: 'seller', shopId, slug: catalog.shop.slug, agentKeyId: key.id, walletId: wallet?.id, createdAt: now.toISOString(), expiresAt, steps: {} };
    await this.deps.store.put(tour);
    return tour;
  }

  /** The demo shop sells to every judge: what they bought comes back on the hour, up to its usual stock. */
  async restock(): Promise<void> {
    const usual = new Map(this.deps.template.products.flatMap((p) => p.variants.map((v) => [v.id, v.inventory])));
    await this.deps.catalogs.modify(this.deps.template.shop.id, (catalog) => {
      let changed = false;
      for (const v of catalog.products.flatMap((p) => p.variants)) {
        const target = usual.get(v.id);
        if (target !== undefined && v.inventory < target) {
          v.inventory = target;
          changed = true;
        }
      }
      return changed;
    });
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

    if (tour.kind === 'seller' && !(SELLER_STEPS as readonly TourStep[]).includes(step)) throw new HttpError(400, `On your own shop the steps are ${SELLER_STEPS.join(', ')}`);
    if (step === 'buy') await (tour.kind === 'seller' ? this.buyFromSeller(tour, result, act) : this.buy(tour, result, act));
    if (step === 'refund') {
      const cartId = tour.steps.buy!.cartId!;
      const refund = await act('owner-agent', 'refund_order', { order_id: cartId, reason: 'Part of the order arrived chipped. Refund the whole order.' }, (r) =>
        r.status === 'pending_approval' ? `Asked to refund ${r.amount}. Guard says: ${r.why.join(' ')} It waits for you.` : `Refund ${r.status}: ${r.next}`,
      );
      result.recordId = refund.say_so_id;
    }
    if (step === 'rules') {
      const policy = await this.deps.saySo.policy(shopId);
      const limit = majorUnits(TOUR_ASKED_REFUND_LIMIT, policy.currency);
      const asked = formatMoney(limit, policy.currency);
      const looser: Policy = {
        ...policy,
        source: `Let my agent refund up to ${asked} on its own.`,
        rules: policy.rules.map((r) => (r.type === 'max_amount' && r.kinds.includes('refund.create') ? { ...r, limit } : r)),
      };
      const record = await this.deps.saySo.submitPolicy(looser, `Let me refund up to ${asked} without asking.`, actor(this.ownerAgent(tour)));
      transcript.push({
        who: 'owner-agent',
        did: 'policy.update',
        said: record.status === 'pending_approval' ? `Tried to raise its own refund limit to ${asked}. Guard says: ${record.decision?.hits.map((h) => h.message).join(' ')}` : `Rules ${record.status}.`,
      });
      result.recordId = record.id;
    }
    if (step === 'earn') await this.earn(tour, result, act);
    if (step === 'commission') {
      const invoice = await act(
        'owner-agent',
        'send_invoice',
        {
          email: `client-${tour.id.slice(5)}@example.com`,
          name: 'Ana',
          items: [{ name: 'Cobalt bud vase, made to order', price: '62.00' }],
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

  /** Expired tour copies go, with everything they made: orders, records, keys, photos, the lent wallet. */
  async sweep(now = new Date()): Promise<number> {
    const expired = await this.deps.store.expired(now);
    for (const tour of expired) {
      await this.deps.access.revokeKey(tour.shopId, tour.agentKeyId);
      if (tour.walletId) await this.deps.wallets.disconnect(tour.walletId).catch(() => undefined);
      await this.deps.catalogs.remove(tour.shopId);
      if (this.deps.housekeeping) {
        await this.deps.housekeeping.forgetShop(tour.shopId);
        if (tour.walletId) await this.deps.housekeeping.forgetWallet(tour.walletId);
      }
      await this.deps.store.remove(tour.id);
    }
    return expired.length;
  }

  /**
   * The buyer's assistant orders a few made-to-order pieces with saved PayPal, then the owner's agent
   * asks for small refunds on that order, each just over the shop's refund rule. The judge decides each one;
   * if they approve them all, Sayso suggests the rule those approvals earned (shown on the tour page).
   */
  private async earn(tour: Tour, result: StepResult, act: Act) {
    if (!tour.walletId) throw new HttpError(409, 'This step needs saved PayPal to pay for its order, and this server has none to lend');
    const catalog = await this.deps.catalogs.byShopId(tour.shopId);
    const piece = catalog?.products.flatMap((p) => p.variants.map((v) => ({ p, v }))).find(({ v }) => v.madeToOrderDays !== undefined);
    if (!catalog || !piece) throw new HttpError(409, 'This shop has nothing made to order to buy');

    const cart = await act('assistant', 'create_cart', { items: [{ variant_id: piece.v.id, quantity: EARN_PIECES }], shipping_address: SHIP_TO }, (r) =>
      `Ordered ${EARN_PIECES} ${piece.p.name}s for a wedding: ${r.totals.total.value} ${r.totals.total.currency_code}.`,
    );
    result.cartId = cart.cart_id;
    await act('assistant', 'pay_with_paypal', { cart_id: cart.cart_id }, (r) => (r.status === 'paid' ? `Paid with saved PayPal. Order ${r.order.number}.` : `Payment ${r.status}: ${r.next}`));

    const currency = catalog.shop.currency;
    result.recordIds = [];
    for (const [i, units] of EARN_REFUNDS.entries()) {
      const amount = toMoney(majorUnits(units, currency), currency).value;
      const refund = await act('owner-agent', 'refund_order', { order_id: cart.cart_id, amount, reason: `Vase ${i + 1} of ${EARN_PIECES} has a small glaze flaw; partial refund.` }, (r) =>
        r.status === 'pending_approval' ? `Asked to refund ${r.amount} for a glaze flaw. Guard held it for you.` : `Refund ${r.status}: ${r.next ?? ''}`.trim(),
      );
      result.recordIds.push(refund.say_so_id);
    }
  }

  /**
   * A buyer's assistant buys from the judge's own shop: the dearest piece it can, enough of them for the
   * order to go past the shop's refund rule (so the refund that follows waits for the judge), and pays
   * with saved PayPal. If the shop can't sell that many, it applies the shop's own fix.
   */
  private async buyFromSeller(tour: Tour, result: StepResult, act: Act) {
    const catalog = await this.deps.catalogs.byShopId(tour.shopId);
    const pick = catalog?.products
      .flatMap((p) => p.variants.map((v) => ({ p, v, room: v.madeToOrderDays !== undefined ? 3 : v.inventory })))
      .filter((x) => x.room > 0 && x.v.price > 0)
      .sort((a, b) => b.v.price - a.v.price)[0];
    if (!catalog || !pick) throw new HttpError(409, 'Your shop has nothing in stock to buy yet');
    const limit = majorUnits(DEFAULT_LIMITS.refundApproval, catalog.shop.currency);
    const quantity = Math.min(pick.room, 3, Math.max(1, Math.floor(limit / pick.v.price) + 1));
    const name = pick.p.name;

    await act('assistant', 'search_products', { query: name }, (r) => `Searched ${r.shop?.name ?? 'your shop'} for "${name}": ${r.products?.length ?? 0} found.`);
    const items = [{ variant_id: pick.v.id, quantity }];
    let cart = await act('assistant', 'create_cart', { items, shipping_address: SHIP_TO }, (r) =>
      r.status === 'INCOMPLETE' ? `Asked for ${quantity}. The shop says: ${r.validation_issues.map((i: Issue) => i.user_message).join(' ')}` : `Cart for ${quantity} × ${name}: ${r.totals.total.value} ${r.totals.total.currency_code} with shipping and tax.`,
    );
    result.cartId = cart.cart_id;
    if (cart.status === 'INCOMPLETE') {
      const fix = (cart.validation_issues as Issue[]).flatMap((i) => i.resolution_options ?? []).find((o) => o.action === 'REDUCE_QUANTITY');
      const fewer = fix?.metadata?.quantity ?? 1;
      cart = await act('assistant', 'update_cart', { cart_id: cart.cart_id, items: [{ variant_id: pick.v.id, quantity: fewer }], shipping_address: SHIP_TO }, (r) =>
        `Applied the shop's fix (buy ${fewer}). Cart ${r.status}: ${r.totals.total.value} ${r.totals.total.currency_code}.`,
      );
    }
    if (!tour.walletId) {
      result.approvalUrl = cart.approval_url;
      result.transcript.push({ who: 'assistant', did: 'approval_url', said: 'Handed the buyer a PayPal link to approve the payment.' });
      return;
    }
    await act('assistant', 'pay_with_paypal', { cart_id: cart.cart_id }, (r) =>
      r.status === 'paid' ? `Paid with the buyer's saved PayPal, inside their limits. Order ${r.order.number}: ${r.order.payment}` : `Payment ${r.status}: ${r.next}`,
    );
  }

  /** A buyer's assistant: search, hit the stock limit, apply the shop's fix, pay. */
  private async buy(tour: Tour, result: StepResult, act: Act) {
    const found = await act('assistant', 'search_products', { query: 'mug', in_stock_only: true }, (r) => `Found ${r.products[0]?.variants.length ?? 0} mugs in stock at ${r.shop.name}.`);
    const mug = found.products[0].variants[0].variant_id as string;
    // Something else in stock from the shop, to make it a real basket.
    const catalog = await this.deps.catalogs.byShopId(tour.shopId);
    const extra = catalog?.products
      .filter((p) => !p.variants.some((v) => v.id === mug))
      .flatMap((p) => p.variants.filter((v) => v.inventory > 0 && v.madeToOrderDays === undefined).map((v) => ({ id: v.id, name: p.name.toLowerCase() })))[0];
    if (!extra) throw new HttpError(409, 'The tour shop has nothing else in stock to add');

    const first = await act('assistant', 'create_cart', { items: [{ variant_id: mug, quantity: 2 }, { variant_id: extra.id, quantity: 1 }], shipping_address: SHIP_TO }, (r) =>
      r.status === 'INCOMPLETE' ? `Asked for 2 mugs and a ${extra.name}. The shop says: ${r.validation_issues.map((i: Issue) => i.user_message).join(' ')}` : `Cart ${r.status}.`,
    );
    result.cartId = first.cart_id;

    // Apply the shop's own resolution option, as the merchant-cart spec intends.
    const issue = (first.validation_issues as Issue[]).find((i) => i.resolution_options?.some((o) => o.action === 'REDUCE_QUANTITY'));
    const quantity = issue?.resolution_options?.find((o) => o.action === 'REDUCE_QUANTITY')?.metadata?.quantity ?? 1;
    const fixed = await act('assistant', 'update_cart', { cart_id: first.cart_id, items: [{ variant_id: mug, quantity }, { variant_id: extra.id, quantity: 1 }], shipping_address: SHIP_TO }, (r) =>
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
