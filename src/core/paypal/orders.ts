// Orders v2 + Payments v2 calls Sayso makes directly (money movement stays on typed REST calls with
// idempotency keys).
//
// Payment flow is authorize-then-capture: the buyer approves in PayPal (their say-so), the merchant's
// Guard checks stock and policy, and only then is the authorization captured. If anything is off the
// authorization is voided and the buyer is never charged.

import type { PayPalCart } from '../cart/spec.ts';
import type { Money } from '../money.ts';
import type { PayPalClient } from './client.ts';

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface OrderAuthorization {
  id: string;
  status: string;
  amount: Money;
  expiration_time?: string;
}

export interface OrderCapture {
  id: string;
  status: string;
  amount: Money;
}

export interface OrderRefund {
  id: string;
  status: string;
  amount: Money;
}

export interface Order {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  intent: 'CAPTURE' | 'AUTHORIZE';
  links: PayPalLink[];
  payer?: { payer_id?: string; email_address?: string };
  purchase_units: {
    reference_id?: string;
    amount: Money;
    payee?: { merchant_id?: string; email_address?: string };
    payments?: { authorizations?: OrderAuthorization[]; captures?: OrderCapture[]; refunds?: OrderRefund[] };
  }[];
}

export interface CreateOrderInput {
  cart: PayPalCart;
  shopName: string;
  /** Our cart id; echoed back by PayPal as reference_id and custom_id. */
  cartId: string;
  returnUrl: string;
  cancelUrl: string;
  /** The buyer's saved PayPal (vault payment token): PayPal authorizes without sending them anywhere. */
  vaultId?: string;
  /** The shop owner's own PayPal merchant id, when sales are paid straight to them. */
  payee?: string;
}

/** Turn a priced, valid cart into a PayPal order the buyer can approve. */
export function createOrderFromCart(client: PayPalClient, input: CreateOrderInput, idempotencyKey: string): Promise<Order> {
  const { cart } = input;
  const totals = cart.totals;
  if (!totals?.subtotal || !totals.shipping || !totals.tax) throw new Error('Cart must be priced before creating an order');
  const currency = totals.total.currency_code;

  return client.post<Order>(
    '/v2/checkout/orders',
    {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: input.cartId,
          custom_id: input.cartId,
          description: `${input.shopName} via Sayso`.slice(0, 127),
          payee: input.payee ? { merchant_id: input.payee } : undefined,
          amount: {
            currency_code: currency,
            value: totals.total.value,
            breakdown: { item_total: totals.subtotal, shipping: totals.shipping, tax_total: totals.tax },
          },
          items: cart.items.map((item) => ({
            name: (item.name ?? 'Item').slice(0, 127),
            sku: item.variant_id,
            quantity: String(item.quantity),
            unit_amount: item.price,
            category: 'PHYSICAL_GOODS',
          })),
          shipping: cart.shipping_address ? { address: cart.shipping_address } : undefined,
        },
      ],
      payment_source: input.vaultId
        ? { paypal: { vault_id: input.vaultId } }
        : {
            paypal: {
              experience_context: {
                brand_name: input.shopName.slice(0, 127),
                user_action: 'PAY_NOW',
                shipping_preference: cart.shipping_address ? 'SET_PROVIDED_ADDRESS' : 'GET_FROM_FILE',
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
              },
            },
          },
    },
    idempotencyKey,
  );
}

export function approvalUrl(order: Order): string | undefined {
  return order.links.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
}

export const getOrder = (client: PayPalClient, orderId: string) => client.get<Order>(`/v2/checkout/orders/${orderId}`);

/** After the buyer approves: place the authorization hold. */
export const authorizeOrder = (client: PayPalClient, orderId: string, idempotencyKey: string) =>
  client.post<Order>(`/v2/checkout/orders/${orderId}/authorize`, {}, idempotencyKey);

export const getAuthorization = (client: PayPalClient, authorizationId: string) =>
  client.get<OrderAuthorization>(`/v2/payments/authorizations/${authorizationId}`);

export const captureAuthorization = (client: PayPalClient, authorizationId: string, amount: Money, idempotencyKey: string) =>
  client.post<OrderCapture>(`/v2/payments/authorizations/${authorizationId}/capture`, { amount, final_capture: true }, idempotencyKey);

export const voidAuthorization = (client: PayPalClient, authorizationId: string, idempotencyKey: string) =>
  client.post<void>(`/v2/payments/authorizations/${authorizationId}/void`, {}, idempotencyKey);

export const getCapture = (client: PayPalClient, captureId: string) => client.get<OrderCapture>(`/v2/payments/captures/${captureId}`);

export const refundCapture = (client: PayPalClient, captureId: string, amount: Money, note: string, idempotencyKey: string) =>
  client.post<OrderRefund>(`/v2/payments/captures/${captureId}/refund`, { amount, note_to_payer: note.slice(0, 255) }, idempotencyKey);

export const getRefund = (client: PayPalClient, refundId: string) => client.get<OrderRefund>(`/v2/payments/refunds/${refundId}`);

/** Adds tracking to the order; PayPal shows it to the buyer and it strengthens seller protection. */
export const addTracking = (
  client: PayPalClient,
  orderId: string,
  input: { captureId: string; trackingNumber: string; carrier: string; notifyPayer?: boolean },
  idempotencyKey: string,
) =>
  client.post<Order>(
    `/v2/checkout/orders/${orderId}/track`,
    { capture_id: input.captureId, tracking_number: input.trackingNumber, carrier: input.carrier, notify_payer: input.notifyPayer ?? true },
    idempotencyKey,
  );
