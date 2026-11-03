# Sayso

**Sell to AI agents, safely.** Sayso makes any small seller buyable by AI shopping agents through PayPal in minutes, and puts a say-so layer between every agent and the money: nothing is charged, refunded or accepted without passing the owner's rules or getting their OK.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (2026).
> Status: work in progress. Sections marked _(planned)_ are being built this week.

## The problem

AI assistants are becoming a place where people shop: PayPal's agentic commerce services already reach ChatGPT, Perplexity and Google's AI surfaces. But getting a store in front of those agents today goes through commerce platforms (Store Sync partners such as Wix, BigCommerce and Shopware) or a protocol integration (Agent Ready with ACP/UCP). Millions of one-person businesses that sell through Instagram DMs, markets or a simple PayPal button have neither, so AI shoppers can't find or buy from them.

And once agents do buy and sell, someone has to make sure they don't overspend, double-refund, or accept a dispute they shouldn't.

## What Sayso does

| Piece | What it does | PayPal |
|---|---|---|
| **Shelf** | Turns photos, a price list or a description into a structured catalog with an LLM, and publishes an agent-ready storefront: an MCP server _(planned)_ plus an implementation of PayPal's **Agentic Commerce merchant-cart API v1**. | Catalog Products API _(planned)_, Orders v2 |
| **Guard** | Every money-moving agent action goes through `propose -> simulate -> decide -> [say-so] -> execute -> verify`, with a tamper-evident audit log. Owners write rules in plain English; the LLM turns them into declarative rules, and the rules decide, not the model. | Orders v2 authorize/capture/void, Payments v2 refunds, `PayPal-Request-Id` idempotency |
| **Ops agent** _(planned)_ | Reacts to PayPal webhooks: adds shipment tracking, sends invoices, proposes refunds and triages disputes, all through Guard. | Webhooks (verified), Shipment Tracking, Invoicing, Disputes via the **PayPal Agent Toolkit / MCP server** |
| **Insights** _(planned)_ | AG Studio dashboard: agent sales by channel, the say-so queue, the audit trail, and **missed demand** (what agents tried to buy and couldn't). | Transaction Search, merchant insights |

### Why authorize-then-capture

The buyer approves in PayPal (their say-so). Sayso then re-checks stock, places an authorization, and captures it through Guard. If the item sold out meanwhile or a rule blocks it, the authorization is voided, so nobody is ever charged for something that can't ship.

## How it fits together

```
Buyer's AI assistant (ChatGPT, any MCP client, Sayso chat)
        |  MCP / merchant-cart API
        v
  Sayso Shelf  ---- priceCart(): catalog prices, shipping, tax, validation issues + resolution options
        |
        v
  Sayso Guard  ---- policy (deterministic) + live simulation + human say-so + verification + audit
        |
        v
  PayPal: Orders v2, Payments v2, Agent Toolkit tools, Webhooks
```

Core logic lives in `src/core` and has no framework dependency; the Next.js app in `src/app` is a thin layer over it.

```
src/core/cart/engine.ts       Pricing + validation for the merchant-cart API
src/core/commerce.ts          create / update / checkout flow (authorize -> Guard capture)
src/core/guard/               Policy rules, the Guard pipeline, hash-chained audit
src/core/paypal/              REST client (idempotency, retries, debug ids), Orders/Payments, executors
src/app/api/shops/[slug]/merchant-cart/...   Spec endpoints
src/app/api/guard/[id]        Owner approves / rejects
tests/                        Unit + end-to-end tests against an in-memory PayPal fake
```

## Run it

Requires Node.js 22.18+ and a PayPal sandbox REST app ([developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)).

```bash
npm install
cp .env.example .env.local   # fill in PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
npm test                     # 22 tests, no network needed
npm run dev
node scripts/try-cart.ts     # acts as an agent: creates a cart, fixes an inventory issue, prints the PayPal approval link
```

Approve with a sandbox **personal** account; PayPal redirects to `/pay/return`, which completes checkout. Open http://localhost:3000 to see the cart and the Guard audit trail.

## For judges

- **Hosted demo:** _(link coming)_. No API keys needed: everything runs server-side.
- **Sandbox buyer login:** provided in the Devpost testing instructions.
- **Try it from your own AI assistant:** add the Sayso MCP URL _(coming)_ to any MCP client (ChatGPT, Cursor, ...) and ask it to buy a mug.

## AI used

- **DeepSeek** (`deepseek-flash`, OpenAI-compatible API) _(planned)_: catalog extraction from photos and text, plain-English policies to rules, the ops agent, the buyer chat.
- **PayPal Agent Toolkit / MCP server** _(planned)_: invoicing, shipment tracking, disputes and reporting tools for the ops agent.

## License

[MIT](LICENSE)
