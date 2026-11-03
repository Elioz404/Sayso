# Sayso

**Sell to AI shoppers. Run your shop with your own AI agent. Nothing moves without your say-so.**

Sayso turns a few photos and a price list into a shop that AI shopping agents can buy from through PayPal, and gives the seller's own AI agent a CLI, MCP tools and an agent skill to run it. Refunds, captures and rule changes go through the owner's say-so rules, and the big ones wait for the owner's OK on their phone, where no agent can reach.

> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (2026). PayPal **sandbox only**.

## The problem

AI assistants are becoming a place where people shop. PayPal's agentic commerce services already reach ChatGPT, Perplexity and Google's AI surfaces, but a store gets there through a commerce platform or a protocol integration. Millions of one-person businesses that sell through Instagram DMs, markets or a PayPal button have neither.

And once agents buy and sell, someone has to run the shop: answer "where's my order", refund the chipped mug, add tracking, restock. The seller's own AI agent could do that today, if it could be trusted with the money.

## What Sayso does

Three doors into the same shop, all backed by one tool registry and one set of rules:

| Who | How | What they can do |
|---|---|---|
| **Buyer agents** (any assistant) | PayPal's **Agentic Commerce merchant-cart API v1** and a public **MCP** endpoint per shop | Search, build a cart with exact prices, shipping and tax, fix stock problems with the spec's `resolution_options`, and send the buyer to PayPal to approve |
| **The seller's own agent** | The **`sayso` CLI**, a seller **MCP** endpoint, and an **agent skill** | Orders, refunds, tracking, prices, stock, propose new rules. It holds a scoped agent key, never PayPal credentials |
| **The owner** | A web dashboard and a phone-first approval page | Approve or reject what's waiting, publish the shop, issue and revoke agent keys, read the tamper-evident audit log |

### The say-so layer (Guard)

Every money-moving action, from any agent, goes through:

```
propose -> simulate against live PayPal state -> decide (owner's rules) -> [owner's OK] -> execute -> verify -> audit
```

- **Rules decide, not the model.** Owners write rules in plain English ("refunds over $30 need my OK; never accept disputes"). The LLM drafts declarative rules, code validates them, and `evaluate()` applies them deterministically.
- **Agents can't approve.** Approving needs the owner's signed session. Agent keys are rejected on that route, and no tool or CLI command approves anything.
- **Buyers ask, owners decide.** A buyer's assistant can follow its order and ask for a refund with `request_refund`, but that request always waits for the owner, however small.
- **Agents can't loosen their own leash.** Changing the rules is itself a Guard action (`policy.update`) that always waits for the owner when an agent proposes it. This is built in and no policy can turn it off.
- **Simulated first.** A refund larger than what's still refundable, or a capture on an expired authorization, is refused before PayPal is called.
- **Authorize, then capture.** The buyer approves in PayPal; Sayso re-checks stock, places an authorization and captures it through Guard. If the item sold out meanwhile, or the owner rejects a big order, the hold is voided and the buyer is never charged.
- **Idempotent and verified.** Every PayPal write carries a `PayPal-Request-Id`; every result is read back from PayPal before it counts as done.
- **Tamper-evident.** Each record's events form a SHA-256 hash chain (over canonical JSON, so it survives Postgres), re-checked whenever the log is shown.
- **Out-of-band approvals.** Requests that need the owner are pushed to their phone (ntfy) with a link to `/approve/<id>`; the agent only learns "waiting for the owner".

## Try it

**Hosted demo:** _(link added before submission)_. The demo shop is **Maya Ceramics**, a one-person studio in Portland that sells to buyers in several countries.

### 1. Shop as a buyer agent (no key needed)

Add this MCP server to any MCP client and ask it to buy a mug. One URL covers every shop on Sayso:

```
https://<host>/api/shopping/mcp
```

Ask for two speckled mugs: there's only one, so the cart comes back `INCOMPLETE` with resolution options the agent can apply on its own. Approve the payment with a PayPal sandbox **personal** account.

### 2. Run the shop as the owner's agent

```bash
node cli/sayso.ts login --url https://<host> --key <demo agent key from the Devpost testing instructions>
node cli/sayso.ts status
node cli/sayso.ts orders
node cli/sayso.ts refund <order_id> 10.00 --reason "Chipped rim"    # small: runs now
node cli/sayso.ts refund <order_id> --reason "Arrived broken"       # over $50: waits for the owner (exit code 3)
node cli/sayso.ts policy propose "refunds over 30 dollars need my OK"
```

### 3. Be the owner

Open `https://<host>/owner` (the demo has an **Open the demo shop** button), approve what's waiting, and watch the CLI's `sayso check <id>` flip to `done`.

### 4. Open your own shop

`https://<host>/start`: paste a price list or add photos. Sayso drafts the catalog, asks about anything it couldn't tell (it never invents prices, stock or shipping), and gives you an owner secret and an agent key, once. Review, publish, and buyer agents can shop.

## The `sayso` CLI

No dependencies; Node 22.18+ runs the TypeScript file directly (`node cli/sayso.ts`), or build it with `npm run cli:build`.

| Command | What it does |
|---|---|
| `sayso init [photos...] --text "..."` | Draft a new shop from photos and notes |
| `sayso login --key sk_agent_... --url ...` | Sign this machine in with an agent key |
| `sayso status` | Orders, what's waiting for the owner, low stock, what buyers couldn't get |
| `sayso products` / `price <variant> <amount>` / `stock <variant> <qty>` | Catalog |
| `sayso orders` / `order <id>` | Orders and their payment history |
| `sayso refund <order> [amount] --reason "..."` | Refund through the owner's rules |
| `sayso track <order> <carrier> <number>` | Add shipment tracking in PayPal |
| `sayso approvals` / `check <say_so_id>` | What's waiting for the owner (read-only) |
| `sayso policy` / `policy propose "..."` | Show or propose say-so rules |
| `sayso audit` | Audit log with hash-chain checks |
| `sayso tools` / `call <tool> '<json>'` | Any tool, raw |
| `sayso mcp` | Serve the seller tools to a local MCP client over stdio |

`--json` on any command gives machine-readable output. Exit codes: `0` ok, `1` error, `2` usage, **`3` waiting for the owner**, **`4` refused**, so an agent can branch without parsing text.

The agent skill in [`skills/sayso/SKILL.md`](skills/sayso/SKILL.md) (open Agent Skills format) teaches an agent to drive the CLI: always `--json`, start with `status`, never retry a refused action, tell the owner plainly what is waiting.

## MCP

| Endpoint | Auth | Tools |
|---|---|---|
| `POST /api/shopping/mcp` | none (optional `Bearer sk_wallet_...`) | Every published shop: `list_shops`, `search_products` (grouped by shop), `create_cart` (with `shop`), `update_cart`, `get_cart`, `request_refund`, `connect_paypal`, `wallet_status`, `pay_with_paypal` |
| `POST /api/shops/<slug>/mcp` | none | `search_products`, `create_cart`, `update_cart`, `get_cart` (order status, refunds, tracking), `request_refund` (goes to the owner) |
| `POST /api/mcp` | `Authorization: Bearer sk_agent_...` | `shop_overview`, `list_products`, `update_variant`, `list_orders`, `get_order`, `refund_order`, `add_tracking`, `list_approvals`, `get_say_so`, `get_policy`, `propose_policy`, `audit_log` |

Streamable HTTP, stateless JSON responses, protocol versions `2025-11-25`, `2025-06-18` and `2025-03-26`.

**Personal URLs.** Connector screens in assistants such as ChatGPT take a URL, not headers, so every key also works inside a URL:

- Owner's agent: `https://<host>/api/mcp/<sk_agent_...>`, shown when the owner connects an agent (dashboard, Agents). Revoking the key kills the URL.
- Buyer with saved PayPal: `https://<host>/api/shopping/mcp/<sk_wallet_...>`, shown once after they connect PayPal. Their assistant can then pay inside their limits in any chat.

Treat them like passwords. Clients that can send headers can use the plain endpoints with `Authorization: Bearer ...` instead:

```json
{ "mcpServers": { "my-shop": { "url": "https://<host>/api/mcp", "headers": { "Authorization": "Bearer sk_agent_..." } } } }
```

A stdio client can use `{ "command": "node", "args": ["cli/sayso.ts", "mcp"] }` after `sayso login`.

### Paying without a link each time (saved PayPal)

A buyer can let their assistant pay on its own, inside limits they choose:

1. The assistant calls `connect_paypal` and hands the buyer a Sayso link.
2. The buyer picks a per-order and a daily limit there, then approves once in PayPal (**Payment Method Tokens**, saved without a purchase). The limits are shown in PayPal's approval screen and fixed from then on; no tool can raise them.
3. `pay_with_paypal` goes through the **buyer's own Guard** first. Inside the limits, PayPal authorizes the saved account at once and the shop's Guard captures as usual (stock re-check, owner's rules). Over a limit, nothing is charged and the buyer gets the normal approval link for that one order.
4. The buyer can disconnect from the same page; Sayso deletes the PayPal token.

Tested on the sandbox: a $44.99 order paid with no redirect; a $108.12 order over a $100 limit came back for approval.

In this demo every shop is paid into Sayso's sandbox merchant account, so one saved token covers all shops. With shops that have their own PayPal accounts, this would use PayPal's platform (multiparty) vaulting.

## PayPal integration

| PayPal | Used for |
|---|---|
| **Agentic Commerce merchant-cart API v1** (spec) | `POST/PUT/GET /merchant-cart`, `POST /merchant-cart/{id}/checkout`, validation issues with resolution options |
| **Orders v2** | `intent: AUTHORIZE` orders from priced carts, buyer approval, authorize, shipment tracking |
| **Payments v2** | Capture and void authorizations, refunds, reading captures and refunds back to verify |
| **Catalog Products API** | Products registered when a shop is published |
| **Payment Method Tokens (Vault v3)** | Setup token -> buyer approval -> payment token; orders paid with `payment_source.paypal.vault_id`; tokens deleted on disconnect |
| **Idempotency** | `PayPal-Request-Id` on every write, tied to the Guard record |
| **Webhooks** | Signature verification helper (`verify-webhook-signature`) |

## AI

- **DeepSeek** (`deepseek-flash`, OpenAI-compatible API): reads product photos and notes into a draft catalog, and turns the owner's plain-English rules into declarative say-so rules. Both outputs are validated in code; the model never decides whether money moves.
- Any agent the owner already uses can run the shop through the CLI, MCP and skill, and any shopping assistant can buy through MCP or PayPal's platform.

## How it fits together

```
 buyer agents ──MCP / merchant-cart──┐          ┌── sayso CLI / MCP / skill ── owner's agent
                                     v          v
                               tool registry (src/core/tools)
                                     │
               Commerce (carts, checkout)   Seller (orders, refunds, rules)   Shops (onboarding)
                                     │
                         Guard: simulate -> rules -> [owner] -> execute -> verify -> audit
                                     │
                PayPal Orders v2 · Payments v2 · Catalog          owner's phone (/approve/<id>)
```

`src/core` has no framework dependency and is tested end to end against an in-memory PayPal fake. The Next.js app in `src/app` and `src/server` is a thin layer over it.

```
src/core/cart/            Pricing + validation for the merchant-cart API
src/core/commerce.ts      create / update / checkout (authorize -> Guard capture, void on failure)
src/core/guard/           Rules, the Guard pipeline, hash-chained audit, policy changes as actions
src/core/paypal/          REST client (idempotency, retries, debug ids), Orders/Payments/Catalog, executors
src/core/ai/              LLM client, catalog drafting, rule drafting (all output validated)
src/core/tools/           The tool registry shared by MCP, the CLI and the web app
src/core/mcp.ts           Dependency-free MCP (JSON-RPC) server
src/core/access.ts        Agent keys (hashed) and signed owner sessions
src/server/               Wiring, Postgres stores, MCP transport, owner notifications
cli/sayso.ts              The CLI
skills/sayso/SKILL.md     Agent skill
tests/                    Unit + end-to-end tests
```

## Run it locally

Requires Node.js 22.18+ and a PayPal sandbox REST app ([developer.paypal.com](https://developer.paypal.com/dashboard/applications/sandbox)).

```bash
npm install
cp .env.example .env.local   # PayPal sandbox keys; DeepSeek key for onboarding
npm test                     # no network needed
npm run dev
```

Then `node cli/sayso.ts login --url http://localhost:3000 --key <SAYSO_DEMO_AGENT_KEY>` and open http://localhost:3000/owner. `node scripts/try-cart.ts` plays a buyer agent against the merchant-cart API and prints a PayPal approval link.

Without `DATABASE_URL` everything is kept in memory.

## Deploy

[`render.yaml`](render.yaml) is a Render Blueprint: a Node web service plus Postgres, with `SAYSO_SECRET` generated by Render. Set the PayPal and DeepSeek keys, `PUBLIC_BASE_URL` and the demo credentials in the dashboard. The health check is `/api/health`.

## License

[MIT](LICENSE)
