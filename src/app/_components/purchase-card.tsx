// A purchase, set apart from the conversation around it: a cart the shop priced and that is ready to pay
// (PayPal's button goes inside), or, once paid, its receipt. The chat and the cart both use it, so an
// order always looks like an order and never like one more chat message.

import type { ReactNode } from 'react';

export interface PurchaseLine {
  name: string;
  /** The variant ("Sage Green"), when the product has more than one. */
  detail?: string;
  qty: number;
  /** The line's total, formatted. */
  amount?: string;
  image?: string;
}

export interface Purchase {
  shop?: string;
  order?: string;
  lines: PurchaseLine[];
  subtotal?: string;
  shipping?: string;
  tax?: string;
  total?: string;
  /** What the shop says about it now ("Charged. The shop is preparing the order."). */
  status?: string;
  /** When it was paid (ISO). */
  paidAt?: string;
}

/** What PayPal's payment status means for the buyer, in the words the assistant uses too. */
export function paymentWords(status?: string): string {
  if (status === 'CAPTURED') return 'Charged. The shop is preparing the order.';
  if (status === 'AUTHORIZED_PENDING_MERCHANT_REVIEW') return 'Authorized in PayPal. The shop confirms it before charging.';
  return 'Paid with PayPal.';
}

/** "Hand-thrown Mug - Sage Green" (how carts name a line) into the product and its variant. */
export function splitName(name: string): { name: string; detail?: string } {
  const at = name.lastIndexOf(' - ');
  return at > 0 ? { name: name.slice(0, at), detail: name.slice(at + 3) } : { name };
}

/** `onCancel`: a cart not paid yet can be dropped. `onDismiss`: a receipt can be put away. */
export function PurchaseCard({ data, state, children, onCancel, onDismiss }: { data: Purchase; state: 'ready' | 'paid'; children?: ReactNode; onCancel?: () => void; onDismiss?: () => void }) {
  const paid = state === 'paid';
  return (
    <section className={`purchase purchase-${state}`} aria-label={paid ? `Receipt${data.order ? ` for order ${data.order}` : ''}` : 'Cart ready to pay'}>
      <header className="purchase-head">
        <span className="purchase-badge">
          <span aria-hidden="true">{paid ? '✓' : '●'}</span> {paid ? 'Paid with PayPal' : 'Ready to pay'}
        </span>
        <span className="purchase-meta">
          {data.order && <span className="mono">{data.order}</span>}
          {paid && data.paidAt && <span>{new Date(data.paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
        </span>
        {onCancel && !paid && (
          <button type="button" className="purchase-cancel" onClick={onCancel} title="Nothing is charged until you approve in PayPal">
            Cancel
          </button>
        )}
        {onDismiss && (
          <button type="button" className="purchase-close" onClick={onDismiss} aria-label="Hide this receipt">
            ×
          </button>
        )}
      </header>
      <div className="purchase-body">
        {data.shop && <b className="purchase-shop">{data.shop}</b>}
        <ul className="purchase-lines">
          {data.lines.map((l, i) => (
            <li key={i}>
              <span className="purchase-thumb">{l.image && <img src={l.image} alt="" loading="lazy" />}</span>
              <span className="purchase-name">
                <span>{l.name}</span>
                {l.detail && <span className="small muted">{l.detail}</span>}
              </span>
              <span className="small muted">×{l.qty}</span>
              <span className="num">{l.amount}</span>
            </li>
          ))}
        </ul>
        <dl className="purchase-totals">
          {data.subtotal && (
            <>
              <dt>Subtotal</dt>
              <dd>{data.subtotal}</dd>
            </>
          )}
          {data.shipping && (
            <>
              <dt>Shipping</dt>
              <dd>{data.shipping}</dd>
            </>
          )}
          {data.tax && (
            <>
              <dt>Tax</dt>
              <dd>{data.tax}</dd>
            </>
          )}
          <dt className="purchase-total">{paid ? 'Total paid' : 'Total'}</dt>
          <dd className="purchase-total">{data.total}</dd>
        </dl>
        {data.status && <p className="purchase-status small">{data.status}</p>}
        {children}
      </div>
    </section>
  );
}
