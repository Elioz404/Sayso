// How an order's payment reads to the buyer, in one place: the buyer's assistant (tools), the order page
// and the receipt cards in the chat all say the same thing. Plain data, safe to import in the browser.

/** paid: charged, being prepared; waiting: authorized, the shop confirms before charging; refund-asked: the buyer's refund request waits for the owner. */
export type BuyerOrderState = 'paid' | 'waiting' | 'shipped' | 'refund-asked' | 'refunded' | 'cancelled';

/** The order's payment, by the shop's order status. */
export const PAYMENT_FOR_BUYER: Readonly<Record<string, string>> = {
  paid: 'Charged. The shop is preparing the order.',
  awaiting_owner: 'Authorized in PayPal. The shop confirms it before charging.',
  released: 'Cancelled by the shop. The buyer was not charged and the PayPal hold was released.',
};

/** The short label on a receipt, by the order's state for the buyer. */
export const ORDER_STATE_LABEL: Readonly<Record<BuyerOrderState, string>> = {
  paid: 'Paid with PayPal',
  shipped: 'Shipped',
  waiting: 'Authorized in PayPal',
  'refund-asked': 'Refund asked',
  refunded: 'Refunded',
  cancelled: 'Cancelled, not charged',
};

/** The payment right after checkout, from the payment status the cart reports. */
export function paymentWords(status?: string): string {
  if (status === 'CAPTURED') return PAYMENT_FOR_BUYER.paid;
  if (status === 'AUTHORIZED_PENDING_MERCHANT_REVIEW') return PAYMENT_FOR_BUYER.awaiting_owner;
  return ORDER_STATE_LABEL.paid + '.';
}
