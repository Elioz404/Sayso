// Buyer tools: what any shopping assistant can do at published shops, on the all-shops endpoint or one
// shop's own endpoint. Paying with a saved PayPal goes through the buyer's own Guard (their limits).

import { formatMoney } from '../money.ts';
import { searchCatalog } from '../search.ts';
import { address, customer, items, money, shopArg } from './args.ts';
import { buyerActor, liveCatalog, ownCart, query, shopFor, ToolError, walletFrom, type Tool } from './context.ts';
import { cartForAgent, catalogView, orderForBuyer, refundRequestForBuyer } from './views.ts';

export const buyerTools: Tool[] = [
  {
    name: 'list_shops',
    title: 'List shops',
    description: 'Every shop you can buy from here, with what it sells and where it ships from.',
    side: 'buyer',
    marketplaceOnly: true,
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
    async run(_input, ctx) {
      const live = await ctx.services.catalogs.listLive();
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
        return { shop: view.shop, products: searchCatalog(catalog, query(catalog, input)), shipping: view.shipping, returns: `${catalog.shop.returnPolicy.days} days` };
      }
      const live = (await ctx.services.catalogs.listLive()).filter((c) => !input.shop || c.shop.slug === input.shop);
      if (input.shop && live.length === 0) throw new ToolError(`No open shop called ${input.shop}. Use list_shops.`);
      const results = live
        .map((catalog) => ({ catalog, products: searchCatalog(catalog, query(catalog, input)) }))
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
        customer,
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
      properties: { cart_id: { type: 'string', maxLength: 60 }, items, shipping_address: address, customer },
      required: ['cart_id', 'items'],
    },
    async run(input, ctx) {
      await ownCart(ctx, input.cart_id);
      const cart = await ctx.services.commerce.updateCart(input.cart_id, { items: input.items, shipping_address: input.shipping_address, customer: input.customer });
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
      const { cart, records } = await ctx.services.orders.get(shopId, input.cart_id);
      if (!cart.captureId) throw new ToolError('This order has not been charged, so there is nothing to refund.');
      const open = records.find((r) => r.action.kind === 'refund.create' && r.action.actor.side === 'buyer' && r.status === 'pending_approval');
      if (open) return { ...refundRequestForBuyer(open), note: 'A request for this order is already with the shop owner.' };
      const record = await ctx.services.orders.refund(
        shopId,
        input.cart_id,
        { amount: input.amount, reason: input.reason },
        buyerActor(ctx),
      );
      return refundRequestForBuyer(record);
    },
  },
  {
    name: 'connect_paypal',
    title: 'Let me pay without asking every time',
    description:
      "Set up the buyer's PayPal so you can pay for them later without a PayPal link each time. Returns connect_url: give it to the buyer. They choose their limits (per order and per day) and approve once in PayPal. Keep wallet_key secret and send it with pay_with_paypal. Purchases over their limits still need their approval.",
    side: 'buyer',
    inputSchema: { type: 'object', properties: { assistant_name: { type: 'string', maxLength: 40, description: 'How the buyer knows you, e.g. "ChatGPT"' } } },
    async run(input, ctx) {
      const { wallet, key, connectUrl } = await ctx.services.wallets.create(String(input.assistant_name ?? ctx.channel));
      return {
        wallet_key: key,
        connect_url: connectUrl,
        status: wallet.status,
        next: 'Send the buyer to connect_url. Until they finish, keep using approval_url links. Then call pay_with_paypal with wallet_key.',
      };
    },
  },
  {
    name: 'wallet_status',
    title: 'Saved PayPal status',
    description: "Whether the buyer's saved PayPal is connected, and their limits.",
    side: 'buyer',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { wallet_key: { type: 'string', maxLength: 80 } } },
    async run(input, ctx) {
      const wallet = await walletFrom(ctx, input.wallet_key);
      return {
        status: wallet.status,
        paypal_account: wallet.payerEmail,
        limits: { per_order: formatMoney(wallet.limits.perOrder, wallet.limits.currency), per_day: formatMoney(wallet.limits.daily, wallet.limits.currency) },
        manage_url: ctx.services.wallets.connectUrl(wallet),
      };
    },
  },
  {
    name: 'pay_with_paypal',
    title: 'Pay with saved PayPal',
    description:
      "Pay for a cart with the buyer's saved PayPal, without sending them a link. Inside their limits it is paid at once; over a limit nothing is charged and you get approval_url for the buyer to approve this one order. The shop still confirms stock before charging.",
    side: 'buyer',
    inputSchema: {
      type: 'object',
      properties: { cart_id: { type: 'string', maxLength: 60 }, wallet_key: { type: 'string', maxLength: 80, description: 'From connect_paypal, unless sent as the Authorization header' } },
      required: ['cart_id'],
    },
    async run(input, ctx) {
      const shopId = await ownCart(ctx, input.cart_id);
      const wallet = await walletFrom(ctx, input.wallet_key);
      const result = await ctx.services.wallets.pay(wallet, input.cart_id, ctx.channel);
      if (result.outcome === 'needs_approval') {
        return {
          status: 'needs_buyer_approval',
          why: result.record?.decision?.hits.map((h) => h.message) ?? ["This shop's currency isn't covered by the buyer's limits."],
          approval_url: result.approvalUrl,
          next: 'Nothing was charged. This order is over what the buyer allowed you to spend alone: send them approval_url to approve it in PayPal.',
        };
      }
      return {
        status: result.outcome === 'paid' ? 'paid' : 'authorized_waiting_for_shop',
        order: await orderForBuyer(ctx, shopId, input.cart_id),
        next: result.outcome === 'paid' ? 'Paid with the saved PayPal. Tell the buyer.' : 'PayPal authorized it; the shop owner confirms before charging.',
      };
    },
  },
];
