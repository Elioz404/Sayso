// Seller tools: the owner's own agent running the shop with its agent key. Anything that moves money or
// changes the rules goes through Guard; no tool can approve a say-so request.

import { parseAmount } from '../money.ts';
import { money } from './args.ts';
import { actor, shop, ToolError, type Tool } from './context.ts';
import { catalogView, sayso } from './views.ts';

export const sellerTools: Tool[] = [
  {
    name: 'shop_overview',
    title: 'Shop overview',
    description: 'Start here. Orders by status, say-so requests waiting for the owner, what buyers could not get, and the shop status.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const shopId = shop(ctx);
      const { orders: shopOrders, saySo, shops } = ctx.services;
      const [catalog, orders, approvals, missed] = await Promise.all([shops.get(shopId), shopOrders.list(shopId), saySo.pending(shopId), shopOrders.missedDemand(shopId)]);
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
      const price = input.price !== undefined ? parseAmount(input.price, catalog.shop.currency) : undefined;
      if (input.price !== undefined && !price) throw new ToolError(`price must be more than zero, e.g. 24.00 (${catalog.shop.currency})`);
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
      return ctx.services.orders.list(shop(ctx), { status: input.status, limit: input.limit ?? 25 });
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
      const { order, cart, records } = await ctx.services.orders.get(shop(ctx), input.order_id);
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
      const record = await ctx.services.orders.refund(shop(ctx), input.order_id, { amount: input.amount, reason: input.reason }, actor(ctx));
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
      return ctx.services.orders.addTracking(shop(ctx), input.order_id, input.carrier, input.tracking_number);
    },
  },
  {
    name: 'send_invoice',
    title: 'Invoice a custom order',
    description:
      "Send a PayPal invoice for a custom order agreed with a buyer (a commission, a made-to-order piece), optionally with a deposit. Goes through the owner's rules: a large invoice, or the first one to someone who has never paid the shop, waits for the owner. Prices are what the owner agreed, in the shop's currency.",
    side: 'seller',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', maxLength: 254, description: "The buyer's email (their PayPal email works best)" },
        name: { type: 'string', maxLength: 120 },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 2, maxLength: 200 }, price: money, quantity: { type: 'integer', minimum: 1, maximum: 999 } },
            required: ['name', 'price'],
          },
        },
        note: { type: 'string', maxLength: 1000, description: 'Shown to the buyer, e.g. "Cobalt glaze, ships in about 10 days"' },
        due_in_days: { type: 'integer', minimum: 0, maximum: 30, description: '0 (default) means due on receipt; 10, 15 or 30' },
        deposit: { ...money, description: 'Let the buyer pay this much first, e.g. half up front' },
      },
      required: ['email', 'items'],
    },
    async run(input, ctx) {
      const due = input.due_in_days ?? 0;
      if (![0, 10, 15, 30].includes(due)) throw new ToolError('due_in_days must be 0, 10, 15 or 30');
      const record = await ctx.services.invoicing.send(
        shop(ctx),
        { to: { email: input.email, name: input.name }, items: input.items, note: input.note, dueDays: due, deposit: input.deposit },
        actor(ctx),
      );
      return { ...sayso(record, ctx), invoice: record.result ? { number: record.result.number, status: record.result.status, payer_url: record.result.payer_url } : undefined };
    },
  },
  {
    name: 'list_invoices',
    title: 'Invoices',
    description: 'Invoices sent for custom orders, newest first, with their live status in PayPal (sent, paid, partially paid...) and the payment link.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    async run(input, ctx) {
      return ctx.services.invoicing.list(shop(ctx), input.limit ?? 20);
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
      return (await ctx.services.saySo.pending(shop(ctx))).map((r) => sayso(r, ctx));
    },
  },
  {
    name: 'get_say_so',
    title: 'Check a say-so request',
    description: 'Status of one say-so request (e.g. after asking the owner): pending_approval, verified, unverified, rejected, denied or failed.',
    side: 'seller',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { say_so_id: { type: 'string', maxLength: 40 } }, required: ['say_so_id'] },
    async run(input, ctx) {
      return sayso(await ctx.services.saySo.record(shop(ctx), input.say_so_id), ctx);
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
      return ctx.services.saySo.describePolicy(shop(ctx));
    },
  },
  {
    name: 'propose_policy',
    title: 'Propose new rules',
    description: 'Turn the owner\'s words into say-so rules, e.g. "refunds over $30 need my OK; invoices to new clients always need my OK". The new rules only apply after the owner approves them.',
    side: 'seller',
    inputSchema: { type: 'object', properties: { rules: { type: 'string', minLength: 5, maxLength: 2_000 } }, required: ['rules'] },
    async run(input, ctx) {
      const { record, unclear } = await ctx.services.saySo.proposePolicy(shop(ctx), input.rules, actor(ctx));
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
      return (await ctx.services.saySo.audit(shop(ctx), input.limit ?? 20)).map((r) => ({
        ...sayso(r, ctx),
        events: r.events.map((e) => ({ at: e.at, type: e.type, by: e.by })),
        chain_intact: r.chainIntact,
      }));
    },
  },
];
