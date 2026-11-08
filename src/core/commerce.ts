// Merchant side of PayPal's agentic-commerce flow, framework-agnostic so it's testable end to end.
// HTTP routes (src/app/api/shops/[slug]/merchant-cart/...) and the shopping MCP are thin wrappers.
//
//   createCart  -> price + validate, attach a PayPal order (AUTHORIZE)
//   updateCart  -> re-price; recreate the order if the total changed
//   checkout    -> the buyer approved in PayPal: re-check, authorize, take stock, capture through Guard
//   authorizeSaved / settleSaved -> the same with the buyer's saved PayPal, inside their limits
//
// Whatever happens, an order that will not ship releases its hold and gives its stock back (release()).

import { randomBytes } from 'node:crypto';
import { IN_PAYPAL, OPS_AGENT } from './actors.ts';
import { findVariant, isLive, returnStock, stockLines, takeStock, type Catalog } from './catalog.ts';
import { isPayable, priceCart } from './cart/engine.ts';
import { parseCartInput } from './cart/input.ts';
import type { CheckoutResult, PayPalCart, ValidationIssue } from './cart/spec.ts';
import { HttpError, notFound } from './errors.ts';
import type { Guard } from './guard/engine.ts';
import type { Actor, GuardRecord } from './guard/types.ts';
import type { Links } from './links.ts';
import { KeyedLock } from './lock.ts';
import { toMinor, type Money } from './money.ts';
import type { PayPalClient } from './paypal/client.ts';
import { approvalUrl, authorizeOrder, createOrderFromCart, getAuthorization, getOrder, type OrderAuthorization } from './paypal/orders.ts';
import type { CartStore, CatalogStore, OrderDispute, StoredCart } from './stores.ts';

export interface CommerceDeps {
  paypal: PayPalClient;
  carts: CartStore;
  catalogs: CatalogStore;
  guard: Guard;
  links: Links;
}

const NOT_CHARGED = 'The shop could not accept this payment. You have not been charged.';

export class Commerce {
  private readonly deps: CommerceDeps;
  private readonly lock = new KeyedLock();

  constructor(deps: CommerceDeps) {
    this.deps = deps;
    // A capture the owner decides later (approve or reject from their phone) settles the order then.
    deps.guard.subscribe((record) => this.onSettled(record));
  }

  async createCart(shopSlug: string, body: unknown, channel?: string): Promise<PayPalCart> {
    const input = parseCartInput(body);
    const catalog = await this.deps.catalogs.bySlug(shopSlug);
    if (!catalog || !isLive(catalog)) throw notFound(`Shop ${shopSlug}`);
    const now = new Date().toISOString();
    const stored: StoredCart = {
      id: `cart_${randomBytes(8).toString('hex')}`,
      shopId: catalog.shop.id,
      cart: priceCart(catalog, input, { mode: 'create' }),
      channel,
      createdAt: now,
      updatedAt: now,
    };
    await this.attachPayment(stored, catalog);
    await this.deps.carts.put(stored);
    return view(stored);
  }

  /** The cart as it is now; once paid, with the order it became (as checkout answered), so a page that
   *  paid elsewhere can show the receipt. */
  async getCart(cartId: string, shopId?: string): Promise<PayPalCart> {
    const stored = await this.stored(cartId, shopId);
    return stored.cart.status === 'COMPLETED' && stored.merchantOrderNumber ? completed(stored) : view(stored);
  }

  async shopOf(cartId: string): Promise<string | undefined> {
    return (await this.deps.carts.get(cartId))?.shopId;
  }

  /** PUT replaces the whole cart, per the spec. */
  updateCart(cartId: string, body: unknown, shopId?: string): Promise<PayPalCart> {
    const input = parseCartInput(body);
    return this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId, shopId);
      if (stored.cart.status === 'COMPLETED') throw new HttpError(422, 'Cart is already completed');
      if (stored.authorizationId) throw new HttpError(409, 'This cart is being paid; start a new cart to change it');
      const catalog = await this.catalogById(stored.shopId);
      stored.cart = priceCart(catalog, input, { mode: 'update' });
      stored.updatedAt = new Date().toISOString();
      await this.attachPayment(stored, catalog);
      await this.deps.carts.put(stored);
      return view(stored);
    });
  }

  checkout(cartId: string, body: unknown, shopId?: string): Promise<CheckoutResult> {
    return this.complete(cartId, body, shopId).then((done) => done.result);
  }

  /**
   * Checkout, and whether this very call took the payment (`settledNow`) rather than replaying a cart
   * that was already completed. Only the call that settled may treat its caller as the buyer.
   */
  complete(cartId: string, body: unknown, shopId?: string): Promise<{ result: CheckoutResult; settledNow: boolean }> {
    const input = parseCartInput(body);
    return this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId, shopId);
      const token = input.payment_method?.token;
      if (!token || token !== stored.orderId) {
        throw new HttpError(422, 'payment_method.token does not match this cart', issueBody(stored, paymentIssue('Payment token does not match this cart.')));
      }
      // Return-URL refreshes and platform retries must not charge twice.
      if (stored.cart.status === 'COMPLETED') return { result: completed(stored), settledNow: false };

      const order = await getOrder(this.deps.paypal, token);
      if (order.status !== 'APPROVED') {
        throw new HttpError(422, `PayPal order is ${order.status}`, issueBody(stored, paymentIssue('The buyer has not approved the payment in PayPal yet.')));
      }

      await this.recheck(stored);
      const authorized = await authorizeOrder(this.deps.paypal, token, `${stored.id}-authorize`);
      const authorization = authorized.purchase_units[0]?.payments?.authorizations?.[0];
      if (!authorization) throw new HttpError(502, 'PayPal returned no authorization');
      // Who paid comes from PayPal's order only, never from the request (or the return URL's PayerID).
      return { result: await this.settle(stored, authorization, order.payer?.email_address, order.payer?.payer_id), settledNow: true };
    });
  }

  /**
   * Pay with the buyer's saved PayPal (a vault payment token): no redirect, PayPal authorizes at once.
   * Call it only after the buyer's own Guard allowed the purchase. The shop settles it with settleSaved().
   */
  authorizeSaved(cartId: string, vaultId: string): Promise<{ orderId: string; authorizationId: string; amount: Money }> {
    return this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId);
      if (stored.cart.status === 'COMPLETED') throw new HttpError(422, 'This cart is already paid');
      if (stored.paidWith === 'saved-paypal' && stored.orderId && stored.authorizationId) {
        const existing = await getAuthorization(this.deps.paypal, stored.authorizationId);
        return { orderId: stored.orderId, authorizationId: existing.id, amount: existing.amount };
      }
      const catalog = await this.recheck(stored);
      const total = stored.cart.totals!.total.value;
      const order = await createOrderFromCart(
        this.deps.paypal,
        { cart: stored.cart, cartId: stored.id, shopName: catalog.shop.name, returnUrl: '', cancelUrl: '', vaultId, payee: catalog.shop.payout?.merchantId },
        `${stored.id}-saved-${total}`,
      );
      let authorization = order.purchase_units[0]?.payments?.authorizations?.[0];
      if (!authorization) {
        const authorized = await authorizeOrder(this.deps.paypal, order.id, `${stored.id}-saved-authorize`);
        authorization = authorized.purchase_units[0]?.payments?.authorizations?.[0];
      }
      if (!authorization) throw new HttpError(502, 'PayPal did not authorize the saved PayPal account');
      Object.assign(stored, {
        orderId: order.id,
        orderTotal: total,
        approvalUrl: undefined,
        authorizationId: authorization.id,
        paidWith: 'saved-paypal',
        payee: catalog.shop.payout?.merchantId,
      });
      await this.deps.carts.put(stored);
      return { orderId: order.id, authorizationId: authorization.id, amount: authorization.amount };
    });
  }

  /** The shop's half of a saved-PayPal purchase: capture through the shop's Guard, or release the hold. */
  settleSaved(cartId: string, payerEmail?: string, buyerRecordId?: string): Promise<CheckoutResult> {
    return this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId);
      if (stored.cart.status === 'COMPLETED') return completed(stored);
      if (!stored.authorizationId || !stored.orderId) throw new HttpError(422, 'Nothing was authorized for this cart');
      if (buyerRecordId) stored.buyerRecordId = buyerRecordId;
      const authorization = await getAuthorization(this.deps.paypal, stored.authorizationId);
      return this.settle(stored, authorization, payerEmail);
    });
  }

  /** Stock or prices may have changed since the cart was priced. Re-check before placing any hold. */
  private async recheck(stored: StoredCart): Promise<Catalog> {
    const catalog = await this.catalogById(stored.shopId);
    const repriced = priceCart(catalog, stored.cart, { mode: 'update' });
    if (!isPayable(repriced) || repriced.totals?.total.value !== stored.orderTotal) {
      stored.cart = repriced;
      await this.deps.carts.put(stored);
      throw new HttpError(422, 'Cart changed before checkout', view(stored));
    }
    return catalog;
  }

  /**
   * Take the stock, then capture through the shop's Guard like any other money movement: simulated
   * against the live authorization, checked against the shop's policy (big orders can wait for the
   * owner), executed idempotently and verified. If it can't go through, the order is released.
   */
  private async settle(stored: StoredCart, authorization: OrderAuthorization, payerEmail?: string, payerId?: string): Promise<CheckoutResult> {
    stored.authorizationId = authorization.id;
    // A settle that stopped half way already holds its stock (saved below): never take it twice.
    if (!stored.reserved) {
      const lines = stockLines(stored.cart.items);
      let makeDays: (number | null)[] = [];
      const took = await this.deps.catalogs.modify(stored.shopId, (catalog) => {
        // Read the lead times in the same atomic step that takes the stock: what was promised is kept.
        makeDays = stored.cart.items.map((i) => (i.variant_id ? (findVariant(catalog, i.variant_id)?.variant.madeToOrderDays ?? null) : null));
        return takeStock(catalog, lines);
      });
      if (!took) {
        await this.release(stored, 'An item sold out while the buyer was paying.', OPS_AGENT);
        await this.recheck(stored).catch(() => undefined); // records the sold-out issue on the cart
        throw new HttpError(422, 'An item sold out before payment completed', issueBody(stored, paymentIssue(`${NOT_CHARGED} An item just sold out.`)));
      }
      stored.reserved = lines;
      stored.makeDays = makeDays;
      stored.placedAt = new Date().toISOString();
    }
    stored.payerEmail = payerEmail?.toLowerCase();
    if (payerId) stored.payerId = payerId;
    // The stock it holds is saved before anything else can fail, so a release always finds it to give back.
    stored.updatedAt = new Date().toISOString();
    await this.deps.carts.put(stored);

    const record = await this.capture(stored, authorization, payerEmail);
    stored.guardRecordId = record.id;

    if (!placed(record)) {
      await this.release(stored, `Capture ${record.status}: ${reasons(record)}`, OPS_AGENT);
      throw new HttpError(422, 'Payment could not be completed', issueBody(stored, paymentIssue(NOT_CHARGED)));
    }

    // Captured, or waiting for the owner's OK (captured later from the dashboard). Either way the
    // order is placed and its stock is held.
    stored.captureId = captureIdOf(record);
    if (stored.captureId) stored.paidAt = new Date().toISOString();
    stored.cart = {
      ...stored.cart,
      status: 'COMPLETED',
      customer: stored.cart.customer ?? (payerEmail ? { email_address: payerEmail } : undefined),
      payment_method: { type: 'paypal', token: stored.orderId, payer_id: payerId },
    };
    stored.merchantOrderNumber = orderNumber();
    stored.updatedAt = new Date().toISOString();
    await this.deps.carts.put(stored);
    return completed(stored);
  }

  /** Capture through the shop's Guard. If Guard itself fails, the hold and the stock are let go first. */
  private async capture(stored: StoredCart, authorization: OrderAuthorization, payerEmail?: string): Promise<GuardRecord> {
    try {
      return await this.deps.guard.submit(
        {
          kind: 'payment.capture',
          actor: OPS_AGENT,
          ownerId: stored.shopId,
          amount: toMinor(authorization.amount),
          currency: authorization.amount.currency_code,
          counterparty: payerEmail,
          resourceId: authorization.id,
          reason: stored.paidWith === 'saved-paypal' ? "Paid with the buyer's saved PayPal, within their limits; the items are in stock." : 'The buyer approved in PayPal and the items are in stock.',
          params: { cartId: stored.id, orderId: stored.orderId, channel: stored.channel },
        },
        { idempotencyKey: `${stored.id}-capture` },
      );
    } catch (err) {
      await this.release(stored, `Checkout stopped: ${err instanceof Error ? err.message : 'unexpected error'}`, OPS_AGENT);
      throw err;
    }
  }

  /** A placed order's capture finished later: keep the order in step, or release it if it never will. */
  private async onSettled(record: GuardRecord): Promise<void> {
    const cartId = record.action.params?.cartId;
    if (record.action.kind !== 'payment.capture' || typeof cartId !== 'string') return;
    const peek = await this.deps.carts.get(cartId);
    // During checkout the cart is not placed yet and settle() handles the outcome itself.
    if (!peek || peek.guardRecordId !== record.id || peek.cart.status !== 'COMPLETED') return;

    await this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId);
      if (placed(record)) {
        stored.captureId = captureIdOf(record);
        if (stored.captureId) stored.paidAt ??= new Date().toISOString();
      }
      else await this.release(stored, `Capture ${record.status}${record.status === 'rejected' ? ' by the owner' : ''}: ${reasons(record)}`, OPS_AGENT);
      stored.updatedAt = new Date().toISOString();
      await this.deps.carts.put(stored);
    });
  }

  /**
   * PayPal ended the hold of a placed order itself (voided in PayPal, or it ran out before the owner
   * decided). Nothing can be charged any more, so the order is released and its stock given back; the
   * hold is gone already, so nothing is voided. `status` is the authorization's, as read back from PayPal.
   */
  async holdEndedInPayPal(cartId: string, status: string): Promise<boolean> {
    return this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId);
      if (stored.released || stored.captureId || stored.cart.status !== 'COMPLETED') return false;
      const why = status === 'EXPIRED' ? 'The PayPal hold ran out before the order was charged.' : 'The PayPal hold was voided in PayPal.';
      await this.release(stored, why, IN_PAYPAL, { holdGone: true });
      return true;
    });
  }

  /** A buyer's dispute in PayPal, as PayPal has it now, kept on its order. Whether anything changed. */
  async noteDispute(cartId: string, dispute: OrderDispute): Promise<boolean> {
    return this.lock.run(cartId, async () => {
      const stored = await this.stored(cartId);
      const before = stored.disputes?.find((d) => d.id === dispute.id);
      if (before && JSON.stringify(before) === JSON.stringify(dispute)) return false;
      stored.disputes = [...(stored.disputes ?? []).filter((d) => d.id !== dispute.id), dispute];
      stored.updatedAt = new Date().toISOString();
      await this.deps.carts.put(stored);
      return true;
    });
  }

  /** The order will not go through: release the PayPal hold and give back any stock it took. */
  private async release(stored: StoredCart, reason: string, actor: Actor, options: { holdGone?: boolean } = {}): Promise<void> {
    if (stored.released) return;
    let holdVoided = Boolean(options.holdGone);
    if (stored.authorizationId && !options.holdGone) {
      const voided = await this.deps.guard.submit(
        { kind: 'payment.void', actor, ownerId: stored.shopId, resourceId: stored.authorizationId, reason: reason.slice(0, 300), params: { cartId: stored.id } },
        { idempotencyKey: `${stored.id}-void`, notify: false },
      );
      holdVoided = voided.status === 'verified';
    }
    stored.released = { at: new Date().toISOString(), reason, holdVoided };
    // The buyer was not charged, so the purchase stops counting toward their own daily limit.
    if (stored.buyerRecordId) await this.deps.guard.markReleased(stored.buyerRecordId, actor.id, reason).catch(() => undefined);
    const reserved = stored.reserved;
    if (reserved?.length) {
      await this.deps.catalogs.modify(stored.shopId, (catalog) => {
        returnStock(catalog, reserved);
        return true;
      });
    }
    stored.reserved = undefined;
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
        returnUrl: this.deps.links.payReturn(stored.id),
        cancelUrl: this.deps.links.payCancel(stored.id),
        payee: catalog.shop.payout?.merchantId,
      },
      `${stored.id}-order-${total}`,
    );
    stored.orderId = order.id;
    stored.orderTotal = total;
    stored.approvalUrl = approvalUrl(order);
    stored.payee = catalog.shop.payout?.merchantId;
  }

  private async stored(cartId: string, shopId?: string): Promise<StoredCart> {
    const stored = await this.deps.carts.get(cartId);
    if (!stored || (shopId && stored.shopId !== shopId)) throw notFound(`Cart ${cartId}`);
    return stored;
  }

  private async catalogById(shopId: string): Promise<Catalog> {
    const catalog = await this.deps.catalogs.byShopId(shopId);
    if (!catalog) throw notFound(`Shop ${shopId}`);
    return catalog;
  }
}

/** The cart as PayPal and agents see it: the payment method always reflects the current PayPal order. */
function view(stored: StoredCart): PayPalCart {
  const paymentMethod =
    stored.cart.status === 'COMPLETED' || !stored.orderId || !isPayable(stored.cart)
      ? stored.cart.payment_method
      : { type: 'paypal' as const, token: stored.orderId, approval_url: stored.approvalUrl };
  return { ...stored.cart, id: stored.id, payment_method: paymentMethod };
}

function completed(stored: StoredCart): CheckoutResult {
  return {
    ...view(stored),
    payment_confirmation: {
      merchant_order_number: stored.merchantOrderNumber!,
      paypal_order_id: stored.orderId,
      payment_status: stored.captureId ? 'CAPTURED' : 'AUTHORIZED_PENDING_MERCHANT_REVIEW',
      guard_record_id: stored.guardRecordId,
    },
  };
}

/** The capture went through (or may have) or waits for the owner: the order stands. */
function placed(record: GuardRecord): boolean {
  return record.status === 'verified' || record.status === 'unverified' || record.status === 'pending_approval';
}

function captureIdOf(record: GuardRecord): string | undefined {
  return typeof record.result?.capture_id === 'string' ? record.result.capture_id : undefined;
}

function reasons(record: GuardRecord): string {
  return [...(record.decision?.hits.map((h) => h.message) ?? []), record.verification?.detail].filter(Boolean).join(' ');
}

/** Short, unguessable, unambiguous (no 0/O, 1/I): SAY-7K2M9QXD. */
function orderNumber(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  return `SAY-${[...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

function paymentIssue(user_message: string): ValidationIssue {
  return { code: 'PAYMENT_ERROR', type: 'BUSINESS_RULE', message: user_message, user_message };
}

function issueBody(stored: StoredCart, issue: ValidationIssue): PayPalCart {
  return { ...view(stored), validation_status: 'INVALID', validation_issues: [issue] };
}
