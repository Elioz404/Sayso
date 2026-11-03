---
title: Sayso Shops API
---

# Sell to AI agents, with the owner's say-so

Sayso makes small shops buyable by AI shopping agents through PayPal. This API is for agent platforms
that call REST: find shops, search what they sell, build a cart with PayPal's Agentic Commerce
merchant-cart API, send the buyer to PayPal to approve, and complete the checkout.

Money only moves with a say-so. The buyer approves the payment in PayPal, and each shop's Guard
re-checks stock and the owner's rules before anything is captured. If an order can't go through, the
PayPal hold is released and the buyer is not charged.

## The flow

1. **Find** shops with `GET /api/shops` and search one with `GET /api/shops/{slug}/products`.
2. **Price a cart** with `POST /api/shops/{slug}/merchant-cart`. Shipping, tax and stock come from the
   shop. Problems come back as `validation_issues`, each with `resolution_options` your agent can apply
   before `PUT`ting the cart again.
3. **Get the buyer's OK**: send them to `payment_method.approval_url`, a PayPal page.
4. **Complete** with `POST /api/shops/{slug}/merchant-cart/{cartId}/checkout`. A big order may wait for
   the shop owner, then `payment_status` is `AUTHORIZED_PENDING_MERCHANT_REVIEW`. Calling it again never
   charges twice.

Start with the [TypeScript guide](/guides/agent-checkout), or pick your language under **SDKs**.

## Prefer MCP?

Assistants that speak MCP (ChatGPT, or any MCP client) can connect to `/api/shopping/mcp` instead: the
same operations as tools, plus saved PayPal with the buyer's own spending limits.
