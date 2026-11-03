// Merchant side of PayPal's agentic-commerce flow, framework-agnostic so it's testable end to end.
// HTTP routes (src/app/api/merchant-cart/...) and the MCP storefront are thin wrappers over this.
//
//   POST /merchant-cart            -> createCart: price + validate, attach a PayPal order (AUTHORIZE)
//   PUT  /merchant-cart/{id}       -> updateCart: re-price; recreate the order if the total changed
//   POST /merchant-cart/{id}/checkout -> checkout: buyer approved in PayPal; re-check stock,
//        authorize, then capture through Guard (void if anything is wrong, so nobody is charged
//        for something that can't ship).

import { randomUUID } from 'node:crypto';
import { findVariant, isLive, type Catalog } from './catalog.ts';
import { isPayable, priceCart } from './cart/engine.ts';
import type { CheckoutResult, PayPalCart, ValidationIssue } from './cart/spec.ts';
import type { Guard } from './guard/engine.ts';
import type { Actor, GuardRecord } from './guard/types.ts';
import { toMinor, type Money } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { approvalUrl, authorizeOrder, createOrderFromCart, getAuthorization, getOrder, type OrderAuthorization } from './paypal/orders.ts';

export interface StoredCart {
  id: string;
  shopId: string;
  cart: PayPalCart;
  orderId?: string;
  /** Total the PayPal order was created for; a re-priced cart with a new total needs a new order. */
  orderTotal?: string;
  authorizationId?: string;
  captureId?: string;
  guardRecordId?: string;
  merchantOrderNumber?: string;
  /** The authorization was released (owner rejected the capture, or it could not ship). */
  voided?: boolean;
  tracking?: { carrier: string; number: string; addedAt: string };
  /** How the buyer paid: approved in PayPal (default), or with their saved PayPal within their limits. */
  paidWith?: 'saved-paypal';
  /** Who was shopping, as far as we know: e.g. "chatgpt", "mcp-client", "sayso-buyer". */
  channel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CartStore {
  get(id: string): Promise<StoredCart | undefined>;
  put(cart: StoredCart): Promise<void>;
  /** Carts of a shop, newest first. */
  listByShop(shopId: string): Promise<StoredCart[]>;
}

export interface CatalogStore {
  byShopId(shopId: string): Promise<Catalog | undefined>;
  bySlug(slug: string): Promise<Catalog | undefined>;
  decrementInventory(shopId: string, variantId: string, quantity: number): Promise<void>;
  save(catalog: Catalog): Promise<void>;
  list(): Promise<Catalog[]>;
}

export interface CommerceDeps {
  paypal: PayPalClient;
  carts: CartStore;
  catalogs: CatalogStore;
  guard: Guard;
  /** Public base URL, for PayPal return/cancel URLs. */
  baseUrl: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body ?? { name: 'ERROR', message };
  }
}

const OPS_AGENT: Actor = { type: 'agent', id: 'sayso-ops-agent', side: 'merchant' };

export class Commerce {
  private readonly deps: CommerceDeps;

  constructor(deps: CommerceDeps) {
    this.deps = deps;
  }

  async createCart(shopSlug: string, input: PayPalCart, channel?: string): Promise<PayPalCart> {
    const catalog = await this.catalogBySlug(shopSlug);
    if (!isLive(catalog)) throw new HttpError(404, `Shop ${shopSlug} is not published yet`);
    const now = new Date().toISOString();
    const stored: StoredCart = {
      id: `cart_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      shopId: catalog.shop.id,
      cart: priceCart(catalog, input, { mode: 'create' }),
      channel,
      createdAt: now,
      updatedAt: now,
    };
    await this.attachPayment(stored, catalog);
    await this.deps.carts.put(stored);
    return this.view(stored);
  }

  /** The shop a cart belongs to, or undefined if there is no such cart. */
  async shopOf(cartId: string): Promise<string | undefined> {
    return (await this.deps.carts.get(cartId))?.shopId;
  }

  async getCart(cartId: string): Promise<PayPalCart> {
    return this.view(await this.stored(cartId));
  }

  /** PUT replaces the whole cart, per the spec. */
  async updateCart(cartId: string, input: PayPalCart): Promise<PayPalCart> {
    const stored = await this.stored(cartId);
    if (stored.cart.status === 'COMPLETED') throw new HttpError(422, 'Cart is already completed');
    const catalog = await this.catalogById(stored.shopId);
    stored.cart = priceCart(catalog, input, { mode: 'update' });
    stored.updatedAt = new Date().toISOString();
    await this.attachPayment(stored, catalog);
    await this.deps.carts.put(stored);
    return this.view(stored);
  }

  async checkout(cartId: string, input: PayPalCart): Promise<CheckoutResult> {
    const stored = await this.stored(cartId);
    // Return-URL refreshes and platform retries must not charge twice.
    if (stored.cart.status === 'COMPLETED') return this.completed(stored);

    const token = input.payment_method?.token;
    if (!token || token !== stored.orderId) {
      throw new HttpError(422, 'payment_method.token does not match this cart', issueBody(stored, paymentIssue('Payment token does not match this cart.')));
    }

    const order = await getOrder(this.deps.paypal, token);
    if (order.status !== 'APPROVED') {
      throw new HttpError(422, `PayPal order is ${order.status}`, issueBody(stored, paymentIssue('The buyer has not approved the payment in PayPal yet.')));
    }

    await this.recheck(stored);
    const authorized = await authorizeOrder(this.deps.paypal, token, `${stored.id}-authorize`);
    const authorization = authorized.purchase_units[0]?.payments?.authorizations?.[0];
    if (!authorization) throw new HttpError(500, 'PayPal returned no authorization');
    return this.settle(stored, authorization, order.payer?.email_address, input.payment_method?.payer_id);
  }

  /**
   * Pay with the buyer's saved PayPal (a vault payment token): no redirect, PayPal authorizes at once.
   * Call it only after the buyer's own Guard allowed the purchase. Returns the authorization; the
   * shop's side settles it with settleSaved().
   */
  async authorizeSaved(cartId: string, vaultId: string): Promise<{ orderId: string; authorizationId: string; amount: Money }> {
    const stored = await this.stored(cartId);
    if (stored.cart.status === 'COMPLETED') throw new HttpError(422, 'This cart is already paid');
    const catalog = await this.recheck(stored);
    const total = stored.cart.totals!.total.value;
    const order = await createOrderFromCart(
      this.deps.paypal,
      { cart: stored.cart, cartId: stored.id, shopName: catalog.shop.name, returnUrl: '', cancelUrl: '', vaultId },
      `${stored.id}-saved-${total}`,
    );
    let authorization = order.purchase_units[0]?.payments?.authorizations?.[0];
    if (!authorization) {
      const authorized = await authorizeOrder(this.deps.paypal, order.id, `${stored.id}-saved-authorize`);
      authorization = authorized.purchase_units[0]?.payments?.authorizations?.[0];
    }
    if (!authorization) throw new HttpError(502, 'PayPal did not authorize the saved PayPal account');
    stored.orderId = order.id;
    stored.orderTotal = total;
    stored.authorizationId = authorization.id;
    stored.paidWith = 'saved-paypal';
    await this.deps.carts.put(stored);
    return { orderId: order.id, authorizationId: authorization.id, amount: authorization.amount };
  }

  /** The shop's half of a saved-PayPal purchase: capture through the shop's Guard, or release the hold. */
  async settleSaved(cartId: string, payerEmail?: string): Promise<CheckoutResult> {
    const stored = await this.stored(cartId);
    if (stored.cart.status === 'COMPLETED') return this.completed(stored);
    if (!stored.authorizationId || !stored.orderId) throw new HttpError(422, 'Nothing was authorized for this cart');
    const authorization = await getAuthorization(this.deps.paypal, stored.authorizationId);
    return this.settle(stored, authorization, payerEmail);
  }

  /** Stock may have changed since the cart was priced. Re-check before placing any hold. */
  private async recheck(stored: StoredCart): Promise<Catalog> {
    const catalog = await this.catalogById(stored.shopId);
    const repriced = priceCart(catalog, stored.cart, { mode: 'update' });
    if (!isPayable(repriced) || repriced.totals?.total.value !== stored.orderTotal) {
      stored.cart = repriced;
      await this.deps.carts.put(stored);
      throw new HttpError(422, 'Cart changed before checkout', this.view(stored));
    }
    return catalog;
  }

  /**
   * Capture goes through the shop's Guard like any other money movement: simulated against the live
   * authorization, checked against the shop's policy (big orders can require the owner's OK),
   * executed idempotently and verified. If it can't go through, the hold is released.
   */
  private async settle(stored: StoredCart, authorization: OrderAuthorization, payerEmail?: string, payerId?: string): Promise<CheckoutResult> {
    stored.authorizationId = authorization.id;
    const record = await this.deps.guard.submit({
      kind: 'payment.capture',
      actor: OPS_AGENT,
      ownerId: stored.shopId,
      amount: toMinor(authorization.amount),
      currency: authorization.amount.currency_code,
      counterparty: payerEmail,
      resourceId: authorization.id,
      reason: stored.paidWith === 'saved-paypal' ? "Paid with the buyer's saved PayPal, within their limits; the items are in stock." : 'The buyer approved in PayPal and the items are in stock.',
      params: { cartId: stored.id, orderId: stored.orderId, channel: stored.channel },
    });
    stored.guardRecordId = record.id;

    if (record.status === 'denied' || record.status === 'failed') {
      const released = await this.deps.guard.submit({
        kind: 'payment.void',
        actor: OPS_AGENT,
        ownerId: stored.shopId,
        resourceId: authorization.id,
        reason: `Capture ${record.status}: ${record.decision?.hits.map((h) => h.message).join(' ') ?? ''}`.trim(),
      });
      stored.voided = released.status === 'verified';
      await this.deps.carts.put(stored);
      throw new HttpError(422, 'Payment could not be completed', issueBody(stored, paymentIssue('The shop could not accept this payment. You have not been charged.')));
    }

    // verified, or pending the owner's OK (captured later from the dashboard). Either way the
    // order is placed and stock is reserved.
    if (record.status === 'verified') stored.captureId = String(record.result?.capture_id);
    for (const item of stored.cart.items) {
      if (item.variant_id) await this.deps.catalogs.decrementInventory(stored.shopId, item.variant_id, item.quantity);
    }
    stored.cart = {
      ...stored.cart,
      status: 'COMPLETED',
      customer: stored.cart.customer ?? (payerEmail ? { email_address: payerEmail } : undefined),
      payment_method: { type: 'paypal', token: stored.orderId, payer_id: payerId },
    };
    stored.merchantOrderNumber = `SAY-${Date.now().toString(36).toUpperCase()}`;
    stored.updatedAt = new Date().toISOString();
    await this.deps.carts.put(stored);
    return this.completed(stored);
  }

  /**
   * Keep the cart in step with a Guard record that finished later, e.g. a capture the owner approved
   * from their phone after checkout.
   */
  async applyRecord(record: GuardRecord): Promise<void> {
    const cartId = record.action.params?.cartId;
    if (typeof cartId !== 'string' || record.status !== 'verified') return;
    const stored = await this.deps.carts.get(cartId);
    if (!stored) return;
    if (record.action.kind === 'payment.capture' && record.result?.capture_id) stored.captureId = String(record.result.capture_id);
    if (record.action.kind === 'payment.void') stored.voided = true;
    stored.updatedAt = new Date().toISOString();
    await this.deps.carts.put(stored);
  }

  /** Create (or recreate) the PayPal order whenever the cart is payable and its total changed. */
  private async attachPayment(stored: StoredCart, catalog: Catalog): Promise<void> {
    if (!isPayable(stored.cart)) return;
    const total = stored.cart.totals!.total.value;
    if (stored.orderId && stored.orderTotal === total) return;

    const order = await createOrderFromCart(
      this.deps.paypal,
      {
        cart: stored.cart,
        cartId: stored.id,
        shopName: catalog.shop.name,
        returnUrl: `${this.deps.baseUrl}/pay/return?cart=${stored.id}`,
        cancelUrl: `${this.deps.baseUrl}/pay/cancel?cart=${stored.id}`,
      },
      `${stored.id}-order-${total}`,
    );
    stored.orderId = order.id;
    stored.orderTotal = total;
    stored.cart.payment_method = { type: 'paypal', token: order.id, approval_url: approvalUrl(order) };
  }

  private view(stored: StoredCart): PayPalCart {
    return { ...stored.cart, id: stored.id };
  }

  private completed(stored: StoredCart): CheckoutResult {
    return {
      ...this.view(stored),
      payment_confirmation: {
        merchant_order_number: stored.merchantOrderNumber!,
        paypal_order_id: stored.orderId,
        payment_status: stored.captureId ? 'CAPTURED' : 'AUTHORIZED_PENDING_MERCHANT_REVIEW',
        guard_record_id: stored.guardRecordId,
      },
    };
  }

  private async stored(cartId: string): Promise<StoredCart> {
    const stored = await this.deps.carts.get(cartId);
    if (!stored) throw new HttpError(404, `Cart ${cartId} not found`);
    return stored;
  }

  private async catalogBySlug(slug: string): Promise<Catalog> {
    const catalog = await this.deps.catalogs.bySlug(slug);
    if (!catalog) throw new HttpError(404, `Shop ${slug} not found`);
    return catalog;
  }

  private async catalogById(shopId: string): Promise<Catalog> {
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw new HttpError(404, `Shop ${shopId} not found`);
    return catalog;
  }
}

function paymentIssue(user_message: string): ValidationIssue {
  return { code: 'PAYMENT_ERROR', type: 'BUSINESS_RULE', message: user_message, user_message };
}

function issueBody(stored: StoredCart, issue: ValidationIssue): PayPalCart {
  return { ...stored.cart, id: stored.id, validation_status: 'INVALID', validation_issues: [issue] };
}

/** In-memory stores for tests and the zero-config local demo. */
export class MemoryCartStore implements CartStore {
  private readonly carts = new Map<string, StoredCart>();
  async get(id: string) {
    const c = this.carts.get(id);
    return c && structuredClone(c);
  }
  async put(cart: StoredCart) {
    this.carts.set(cart.id, structuredClone(cart));
  }
  all(): StoredCart[] {
    return [...this.carts.values()].map((c) => structuredClone(c));
  }
  async listByShop(shopId: string) {
    return this.all()
      .filter((c) => c.shopId === shopId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class MemoryCatalogStore implements CatalogStore {
  private readonly catalogs: Catalog[];
  constructor(catalogs: Catalog[]) {
    this.catalogs = structuredClone(catalogs);
  }
  async byShopId(shopId: string) {
    return structuredClone(this.catalogs.find((c) => c.shop.id === shopId));
  }
  async bySlug(slug: string) {
    return structuredClone(this.catalogs.find((c) => c.shop.slug === slug));
  }
  async decrementInventory(shopId: string, variantId: string, quantity: number) {
    const catalog = this.catalogs.find((c) => c.shop.id === shopId);
    const found = catalog && findVariant(catalog, variantId);
    if (found && found.variant.madeToOrderDays === undefined) found.variant.inventory = Math.max(0, found.variant.inventory - quantity);
  }
  async save(catalog: Catalog) {
    const i = this.catalogs.findIndex((c) => c.shop.id === catalog.shop.id);
    if (i >= 0) this.catalogs[i] = structuredClone(catalog);
    else this.catalogs.push(structuredClone(catalog));
  }
  async list() {
    return structuredClone(this.catalogs);
  }
}
