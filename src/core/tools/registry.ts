// One registry of tools, three doors: the MCP endpoint, the `sayso` CLI and the HTTP API all call
// these same definitions. Buyer tools are public per shop; seller tools need the shop's agent key.
// Results are plain JSON written for an agent to read and relay to its human.

import { isLive, type Catalog } from '../catalog.ts';
import type { Commerce, CatalogStore } from '../commerce.ts';
import type { Actor, GuardRecord } from '../guard/types.ts';
import { HttpError } from '../commerce.ts';
import { formatMoney, toMinor } from '../money.ts';
import { catalogView, type Seller } from '../seller.ts';
import type { Shops } from '../shops.ts';
import { validate, type JsonSchema } from './schema.ts';

export interface ToolServices {
  commerce: Commerce;
  seller: Seller;
  shops: Shops;
  catalogs: CatalogStore;
  /** Where the owner approves say-so requests, e.g. https://sayso.app/approve */
  approvalsUrl: string;
}

export interface ToolContext {
  services: ToolServices;
  /** Shop the buyer endpoint is scoped to. */
  shopSlug?: string;
  /** The all-shops buyer endpoint: tools search every published shop and take a `shop` argument. */
  marketplace?: boolean;
  /** Set when an agent key was presented; seller tools act on this shop only. */
  agent?: { shopId: string; keyId: string; label: string };
  /** Who is calling, for the audit trail: "mcp", "cli", a client name... */
  channel: string;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  side: 'buyer' | 'seller';
  /** Only on the all-shops endpoint. */
  marketplaceOnly?: boolean;
  inputSchema: Extract<JsonSchema, { type: 'object' }>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run(input: Record<string, any>, ctx: ToolContext): Promise<unknown>;
}

export class ToolError extends Error {}

const address: JsonSchema = {
  type: 'object',
  description: 'Where the order ships. country_code is ISO-3166 alpha-2.',
  properties: {
    address_line_1: { type: 'string', maxLength: 300 },
    address_line_2: { type: 'string', maxLength: 300 },
    admin_area_2: { type: 'string', description: 'City', maxLength: 120 },
    admin_area_1: { type: 'string', description: 'State or province code, e.g. CA', maxLength: 300 },
    postal_code: { type: 'string', maxLength: 60 },
    country_code: { type: 'string', pattern: '^[A-Z]{2}$' },
  },
  required: ['country_code'],
};

const items: JsonSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 20,
  items: {
    type: 'object',
    properties: { variant_id: { type: 'string', maxLength: 80 }, quantity: { type: 'integer', minimum: 1, maximum: 99 } },
    required: ['variant_id', 'quantity'],
  },
};

const money = { type: 'string', pattern: '^\\d+(\\.\\d{1,2})?$', description: 'Decimal amount in the shop currency, e.g. "12.50"' } as const;
const shopArg = { type: 'string', maxLength: 80, description: "The shop's slug from search_products. Only needed on the all-shops endpoint." } as const;

// ---------------------------------------------------------------------------------------------
// Buyer tools: what any shopping agent can do at a published shop.

const buyerTools: Tool[] = [
  {
    name: 'list_shops',
    title: 'List shops',
    description: 'Every shop you can buy from here, with what it sells and where it ships from.',
    side: 'buyer',
    marketplaceOnly: true,
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const live = (await ctx.services.catalogs.list()).filter(isLive);
      return live.map(({ shop, products }) => ({
        shop: shop.slug,
        name: shop.name,
        ships_from: shop.country,
        currency: shop.currency,
        sells: [...new Set(products.map((p) => p.category))].slice(0, 6),
        products: products.length,
      }));
    },
  },
  {
    name: 'search_products',
    title: 'Search products',
    description:
      'Search for products. On a shop endpoint it searches that shop; on the all-shops endpoint it searches every shop (or one, with `shop`) and groups results by shop. Use the variant_id and shop in create_cart.',
    side: 'buyer',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200, description: 'Words to match, e.g. "green mug". Empty lists everything.' },
        max_price: { ...money, description: "Highest price per item, in each shop's currency" },
        in_stock_only: { type: 'boolean' },
        shop: shopArg,
      },
    },
    async run(input, ctx) {
      if (ctx.shopSlug) {
        const catalog = await liveCatalog(ctx);
        if (input.shop && input.shop !== catalog.shop.slug) throw new ToolError(`This endpoint only sells ${catalog.shop.name}; drop the shop argument.`);
        const view = catalogView(catalog);
        return { shop: view.shop, products: matchProducts(catalog, input), shipping: view.shipping, returns: `${catalog.shop.returnPolicy.days} days` };
      }
      const live = (await ctx.services.catalogs.list()).filter((c) => isLive(c) && (!input.shop || c.shop.slug === input.shop));
      if (input.shop && live.length === 0) throw new ToolError(`No open shop called ${input.shop}. Use list_shops.`);
      const results = live
        .map((catalog) => ({ catalog, products: matchProducts(catalog, input) }))
        .filter((r) => r.products.length > 0)
        .slice(0, 10)
        .map(({ catalog, products }) => ({
          shop: catalog.shop.slug,
          name: catalog.shop.name,
          ships_from: catalog.shop.country,
          products: products.slice(0, 10),
          shipping: catalogView(catalog).shipping,
          returns: `${catalog.shop.returnPolicy.days} days`,
        }));
      return { results, next: results.length ? 'Pass the shop and variant_id to create_cart. One cart per shop.' : 'Nothing matched. Try fewer words or list_shops.' };
    },
  },
  {
    name: 'create_cart',
    title: 'Create cart',
    description:
      'Price a cart (items, shipping, tax). If validation_issues come back, apply one of their resolution_options and call update_cart. When status is CREATED, give the buyer payment_method.approval_url: they approve in PayPal and the shop completes the order.',
    side: 'buyer',
    inputSchema: {
      type: 'object',
      properties: {
        shop: shopArg,
        items,
        shipping_address: address,
        customer: { type: 'object', properties: { email_address: { type: 'string', maxLength: 254 } } },
      },
      required: ['items'],
    },
    async run(input, ctx) {
      const shop = shopFor(ctx, input.shop);
      const cart = await ctx.services.commerce.createCart(shop, { items: input.items, shipping_address: input.shipping_address, customer: input.customer }, ctx.channel);
      return { shop, ...cartForAgent(cart) };
    },
  },
  {
    name: 'update_cart',
    title: 'Update cart',
    description: 'Replace the items and/or address of a cart (the whole cart, as in PayPal\'s merchant-cart API). A changed total gets a new approval_url.',
    side: 'buyer',
    inputSchema: {
      type: 'object',
      properties: { cart_id: { type: 'string', maxLength: 60 }, items, shipping_address: address },
      required: ['cart_id', 'items'],
    },
    async run(input, ctx) {
      await ownCart(ctx, input.cart_id);
      const cart = await ctx.services.commerce.updateCart(input.cart_id, { items: input.items, shipping_address: input.shipping_address });
      return cartForAgent(cart);
    },
  },
  {
    name: 'get_cart',
    title: 'Check cart or order',
    description:
      "Current state of a cart. Once the buyer has paid (status COMPLETED), `order` says whether it was charged, how much was refunded, the shipment tracking and any refund the buyer asked for. Use it to answer \"where is my order?\"",
    side: 'buyer',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { cart_id: { type: 'string', maxLength: 60 } }, required: ['cart_id'] },
    async run(input, ctx) {
      const shopId = await ownCart(ctx, input.cart_id);
      const cart = await ctx.services.commerce.getCart(input.cart_id);
      if (cart.status !== 'COMPLETED') return cartForAgent(cart);
      return { ...cartForAgent(cart), order: await orderForBuyer(ctx, shopId, input.cart_id) };
    },
  },
  {
    name: 'request_refund',
    title: 'Ask for a refund',
    description:
      "Ask the shop for a refund on a paid order, with the buyer's reason. This only sends a request: the shop owner always decides, and PayPal refunds the buyer if they agree. Check the answer later with get_cart.",
    side: 'buyer',
    inputSchema: {
      type: 'object',
      properties: {
        cart_id: { type: 'string', maxLength: 60 },
        reason: { type: 'string', minLength: 5, maxLength: 300, description: "The buyer's own words, e.g. \"Arrived with a cracked handle\"" },
        amount: { ...money, description: 'Leave out to ask for everything still refundable' },
      },
      required: ['cart_id', 'reason'],
    },
    async run(input, ctx) {
      const shopId = await ownCart(ctx, input.cart_id);
      const { cart, records } = await ctx.services.seller.order(shopId, input.cart_id);
      if (!cart.captureId) throw new ToolError('This order has not been charged, so there is nothing to refund.');
      const open = records.find((r) => r.action.kind === 'refund.create' && r.action.actor.side === 'buyer' && r.status === 'pending_approval');
      if (open) return { ...refundRequestForBuyer(open), note: 'A request for this order is already with the shop owner.' };
      const record = await ctx.services.seller.refund(
        shopId,
        input.cart_id,
        { amount: input.amount, reason: input.reason },
        { type: 'agent', id: `buyer-agent:${ctx.channel}`, side: 'buyer' },
      );
      return refundRequestForBuyer(record);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Seller tools: the owner's own agent running the shop. Money and rules go through Guard.

const sellerTools: Tool[] = [
  {
    name: 'shop_overview',
    title: 'Shop overview',
    description: 'Start here. Orders by status, say-so requests waiting for the owner, what buyers could not get, and the shop status.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const shopId = shop(ctx);
      const { seller, shops } = ctx.services;
      const [catalog, orders, approvals, missed] = await Promise.all([shops.get(shopId), seller.orders(shopId), seller.approvals(shopId), seller.missedDemand(shopId)]);
      const count = (s: string) => orders.filter((o) => o.status === s).length;
      return {
        shop: { name: catalog.shop.name, slug: catalog.shop.slug, status: catalog.shop.status ?? 'live', currency: catalog.shop.currency },
        orders: { paid: count('paid'), awaiting_owner: count('awaiting_owner'), awaiting_buyer: count('awaiting_buyer'), released: count('released') },
        waiting_for_owner: approvals.map((r) => sayso(r, ctx)),
        missed_demand: missed.slice(0, 10),
        low_stock: catalog.products.flatMap((p) =>
          p.variants.filter((v) => v.madeToOrderDays === undefined && v.inventory <= 1).map((v) => ({ variant_id: v.id, name: `${p.name} (${v.title})`, stock: v.inventory })),
        ),
      };
    },
  },
  {
    name: 'list_products',
    title: 'List products',
    description: 'The full catalog with variant ids, prices and stock.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      return catalogView(await ctx.services.shops.get(shop(ctx)));
    },
  },
  {
    name: 'update_variant',
    title: 'Update price or stock',
    description: 'Set the price and/or stock of one variant.',
    side: 'seller',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: { variant_id: { type: 'string', maxLength: 80 }, price: money, stock: { type: 'integer', minimum: 0, maximum: 100_000 } },
      required: ['variant_id'],
    },
    async run(input, ctx) {
      const shopId = shop(ctx);
      const catalog = await ctx.services.shops.get(shopId);
      const price = input.price !== undefined ? toMinor({ currency_code: catalog.shop.currency, value: input.price }) : undefined;
      if (price === undefined && input.stock === undefined) throw new ToolError('Pass price, stock or both');
      const updated = await ctx.services.shops.setVariant(shopId, input.variant_id, { price, inventory: input.stock });
      return catalogView(updated).products.flatMap((p) => p.variants).find((v) => v.variant_id === input.variant_id);
    },
  },
  {
    name: 'list_orders',
    title: 'List orders',
    description: 'Orders and carts, newest first. paid = charged; awaiting_owner = authorized, waiting for the owner\'s OK; awaiting_buyer = buyer has not approved in PayPal yet.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['paid', 'awaiting_owner', 'awaiting_buyer', 'needs_info', 'released'] }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    },
    async run(input, ctx) {
      return (await ctx.services.seller.orders(shop(ctx), input.status)).slice(0, input.limit ?? 25);
    },
  },
  {
    name: 'get_order',
    title: 'Order details',
    description: 'One order with its items, payment state, tracking and every say-so record attached to it.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { order_id: { type: 'string', maxLength: 60 } }, required: ['order_id'] },
    async run(input, ctx) {
      const { order, cart, records } = await ctx.services.seller.order(shop(ctx), input.order_id);
      return { ...order, totals: cart.cart.totals, ship_to: cart.cart.shipping_address, say_so: records.map((r) => sayso(r, ctx)) };
    },
  },
  {
    name: 'refund_order',
    title: 'Refund an order',
    description:
      'Refund all or part of a paid order. This goes through the owner\'s say-so rules: it may run now, wait for the owner\'s OK, or be refused. You cannot approve it yourself; tell the owner what is waiting.',
    side: 'seller',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: { order_id: { type: 'string', maxLength: 60 }, amount: { ...money, description: 'Leave out to refund everything still refundable' }, reason: { type: 'string', minLength: 3, maxLength: 300 } },
      required: ['order_id', 'reason'],
    },
    async run(input, ctx) {
      const record = await ctx.services.seller.refund(shop(ctx), input.order_id, { amount: input.amount, reason: input.reason }, actor(ctx));
      return sayso(record, ctx);
    },
  },
  {
    name: 'add_tracking',
    title: 'Add tracking',
    description: 'Attach a shipment tracking number to a paid order. PayPal shows it to the buyer.',
    side: 'seller',
    annotations: { idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: { order_id: { type: 'string', maxLength: 60 }, carrier: { type: 'string', maxLength: 40, description: 'PayPal carrier code, e.g. USPS, UPS, FEDEX, DHL' }, tracking_number: { type: 'string', minLength: 4, maxLength: 64 } },
      required: ['order_id', 'carrier', 'tracking_number'],
    },
    async run(input, ctx) {
      return ctx.services.seller.addTracking(shop(ctx), input.order_id, input.carrier, input.tracking_number);
    },
  },
  {
    name: 'list_approvals',
    title: 'Waiting for the owner',
    description: 'Say-so requests waiting for the owner, with what would happen and why it needs them. Read-only: only the owner can approve, from their own device.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      return (await ctx.services.seller.approvals(shop(ctx))).map((r) => sayso(r, ctx));
    },
  },
  {
    name: 'get_say_so',
    title: 'Check a say-so request',
    description: 'Status of one say-so request (e.g. after asking the owner): pending_approval, verified, rejected, denied or failed.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { say_so_id: { type: 'string', maxLength: 40 } }, required: ['say_so_id'] },
    async run(input, ctx) {
      const record = (await ctx.services.seller.audit(shop(ctx), 1_000)).find((r) => r.id === input.say_so_id);
      if (!record) throw new ToolError(`No say-so request ${input.say_so_id} in this shop`);
      return sayso(record, ctx);
    },
  },
  {
    name: 'get_policy',
    title: 'Say-so rules',
    description: 'The owner\'s current rules for what agents may do alone, what needs their OK and what is never allowed.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const shopId = shop(ctx);
      const catalog = await ctx.services.shops.get(shopId);
      return ctx.services.seller.describePolicy(shopId, catalog.shop.currency);
    },
  },
  {
    name: 'propose_policy',
    title: 'Propose new rules',
    description: 'Turn the owner\'s words into say-so rules, e.g. "refunds over $30 need my OK; never accept disputes". The new rules only apply after the owner approves them.',
    side: 'seller',
    inputSchema: { type: 'object', properties: { rules: { type: 'string', minLength: 5, maxLength: 2_000 } }, required: ['rules'] },
    async run(input, ctx) {
      const shopId = shop(ctx);
      const catalog = await ctx.services.shops.get(shopId);
      const { record, unclear } = await ctx.services.seller.proposePolicy(shopId, input.rules, actor(ctx), catalog.shop.currency);
      return { ...sayso(record, ctx), not_understood: unclear };
    },
  },
  {
    name: 'audit_log',
    title: 'Audit log',
    description: 'Every say-so record, newest first, with its hash-chain check (chain_intact false means the record was tampered with).',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    async run(input, ctx) {
      return (await ctx.services.seller.audit(shop(ctx), input.limit ?? 20)).map((r) => ({
        ...sayso(r, ctx),
        events: r.events.map((e) => ({ at: e.at, type: e.type, by: e.by })),
        chain_intact: r.chainIntact,
      }));
    },
  },
];

export const TOOLS: readonly Tool[] = [...buyerTools, ...sellerTools];

/** Tools visible to this caller: buyer tools at a shop endpoint, seller tools with a key. */
export function toolsFor(ctx: Pick<ToolContext, 'shopSlug' | 'agent' | 'marketplace'>): Tool[] {
  return TOOLS.filter((t) => {
    if (t.side === 'seller') return Boolean(ctx.agent);
    return t.marketplaceOnly ? Boolean(ctx.marketplace) : Boolean(ctx.shopSlug || ctx.marketplace);
  });
}

/** Validate, authorize and run one tool. Throws ToolError for anything the agent should fix. */
export async function callTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool "${name}"`);
  if (tool.side === 'seller' && !ctx.agent) throw new ToolError(`${name} needs the shop's agent key (Authorization: Bearer sk_agent_...)`);
  if (tool.side === 'buyer' && !toolsFor(ctx).includes(tool)) {
    throw new ToolError(tool.marketplaceOnly ? `${name} is only on the all-shops endpoint (/api/shopping/mcp)` : `${name} is a buyer tool; call it on /api/shopping/mcp or a shop's own endpoint`);
  }
  const args = input ?? {};
  const errors = validate(tool.inputSchema, args);
  if (errors.length) throw new ToolError(`Invalid arguments: ${errors.join('; ')}`);
  try {
    return await tool.run(args as Record<string, any>, ctx);
  } catch (err) {
    if (err instanceof HttpError) throw new ToolError(err.status >= 500 ? `Shop error: ${err.message}` : err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------------------------

function shop(ctx: ToolContext): string {
  if (!ctx.agent) throw new ToolError('Missing agent key');
  return ctx.agent.shopId;
}

function slug(ctx: ToolContext): string {
  if (!ctx.shopSlug) throw new ToolError('Missing shop');
  return ctx.shopSlug;
}

function actor(ctx: ToolContext): Actor {
  return { type: 'agent', id: `agent:${ctx.agent?.label ?? 'unknown'}:${ctx.agent?.keyId ?? '-'}`, side: 'merchant' };
}

async function liveCatalog(ctx: ToolContext) {
  const catalog = await ctx.services.catalogs.bySlug(slug(ctx));
  if (!catalog || (catalog.shop.status ?? 'live') !== 'live') throw new ToolError(`Shop ${ctx.shopSlug} is not open`);
  return catalog;
}

/** Which shop a cart belongs to; a shop's own endpoint may only see that shop's carts. */
async function ownCart(ctx: ToolContext, cartId: string): Promise<string> {
  const shopId = await ctx.services.commerce.shopOf(cartId);
  if (!shopId) throw new ToolError(`No cart ${cartId}`);
  if (ctx.shopSlug && (await liveCatalog(ctx)).shop.id !== shopId) throw new ToolError(`No cart ${cartId} at this shop`);
  return shopId;
}

/** The shop a new cart is for: the endpoint's own, or the `shop` argument on the all-shops endpoint. */
function shopFor(ctx: ToolContext, given: string | undefined): string {
  if (ctx.shopSlug) {
    if (given && given !== ctx.shopSlug) throw new ToolError(`This endpoint only sells ${ctx.shopSlug}; drop the shop argument.`);
    return ctx.shopSlug;
  }
  if (!given) throw new ToolError('Pass `shop` (from search_products). One cart per shop.');
  return given;
}

function matchProducts(catalog: Catalog, input: Record<string, any>) {
  const { shop } = catalog;
  const words = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  let max = Infinity;
  if (input.max_price) {
    try {
      max = toMinor({ currency_code: shop.currency, value: input.max_price });
    } catch {
      throw new ToolError('max_price must look like 25.00');
    }
  }
  return catalog.products.flatMap((p) => {
    const text = [p.name, p.description, p.category, ...p.tags, ...p.variants.map((v) => v.title)].join(' ').toLowerCase();
    if (!words.every((w) => text.includes(w))) return [];
    const variants = p.variants.filter((v) => v.price <= max && (!input.in_stock_only || v.madeToOrderDays !== undefined || v.inventory > 0));
    if (variants.length === 0) return [];
    return [
      {
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        variants: variants.map((v) => ({
          variant_id: v.id,
          title: v.title,
          price: formatMoney(v.price, shop.currency),
          in_stock: v.madeToOrderDays !== undefined ? `made to order, ships in ~${v.madeToOrderDays} days` : v.inventory,
        })),
      },
    ];
  });
}

const PAYMENT_FOR_BUYER: Record<string, string> = {
  paid: 'Charged. The shop is preparing the order.',
  awaiting_owner: 'Authorized in PayPal. The shop confirms it before charging.',
  released: 'Cancelled by the shop. The buyer was not charged and the PayPal hold was released.',
};

/** What a buyer's assistant may know about a paid order: no internal ids, no other buyers. */
async function orderForBuyer(ctx: ToolContext, shopId: string, cartId: string) {
  const { order, records } = await ctx.services.seller.order(shopId, cartId);
  return {
    number: order.number,
    payment: PAYMENT_FOR_BUYER[order.status] ?? order.status,
    refunded: order.refunded ?? 'nothing',
    tracking: order.tracking ? { carrier: order.tracking.carrier, number: order.tracking.number } : 'not shipped yet',
    refund_requests: records.filter((r) => r.action.kind === 'refund.create' && r.action.actor.side === 'buyer').map(refundRequestForBuyer),
  };
}

function refundRequestForBuyer(record: GuardRecord) {
  const status: Record<string, string> = {
    pending_approval: 'waiting for the shop owner',
    verified: 'refunded through PayPal',
    executed: 'refund sent to PayPal',
    rejected: 'declined by the shop owner',
    denied: 'not possible',
    failed: 'PayPal could not complete it',
  };
  return {
    request_id: record.id,
    amount: record.action.amount !== undefined ? formatMoney(record.action.amount, record.action.currency ?? 'USD') : 'everything still refundable',
    reason: record.action.reason,
    status: status[record.status] ?? record.status,
    ...(record.status === 'denied' ? { why: record.decision?.hits.filter((h) => h.ruleId === 'simulation').map((h) => h.message) } : {}),
    asked_at: record.createdAt,
  };
}

function cartForAgent(cart: Awaited<ReturnType<Commerce['getCart']>>) {
  const next =
    cart.status === 'COMPLETED'
      ? "Order placed. For a problem with it, use request_refund with the buyer's reason."
      : cart.payment_method?.approval_url
        ? 'Send the buyer to approval_url to pay with PayPal. The order completes when they approve.'
        : 'Fix the validation_issues (apply a resolution option with update_cart), then the cart gets an approval_url.';
  return {
    cart_id: cart.id,
    status: cart.status,
    validation_status: cart.validation_status,
    validation_issues: cart.validation_issues,
    items: cart.items,
    totals: cart.totals,
    shipping_options: cart.available_shipping_options,
    approval_url: cart.payment_method?.approval_url,
    next,
  };
}

/** How a Guard record reads to an agent: what happened, why, and what to tell the owner. */
export function sayso(record: GuardRecord, ctx: ToolContext) {
  const currency = record.action.currency ?? 'USD';
  const next: Record<string, string> = {
    pending_approval: `Waiting for the owner. Tell them what you asked for and why; they approve or reject at ${ctx.services.approvalsUrl}/${record.id}. You cannot approve it. Check back with get_say_so.`,
    verified: record.action.kind === 'policy.update' ? 'Done: the new rules apply from now on.' : 'Done and confirmed with PayPal.',
    executed: 'Sent to PayPal; confirmation pending.',
    denied: record.decision?.hits.some((h) => h.ruleId === 'simulation')
      ? 'Blocked before reaching PayPal: it would fail against the live payment state. Nothing moved. Explain why to the owner; do not retry.'
      : 'Refused by the owner\'s rules. Do not retry the same action; explain why to the owner.',
    rejected: 'The owner said no.',
    failed: 'PayPal did not complete it. Nothing else changed.',
    executing: 'In progress.',
  };
  return {
    say_so_id: record.id,
    action: record.action.kind,
    amount: record.action.amount !== undefined ? formatMoney(record.action.amount, currency) : undefined,
    status: record.status,
    what_happens: record.simulation?.effects ?? [],
    why: record.decision?.hits.map((h) => h.message) ?? [],
    next: next[record.status],
    at: record.createdAt,
  };
}
