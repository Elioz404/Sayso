'use client';

// A purchase, set apart from the conversation around it: a cart the shop priced and that is ready to pay
// (PayPal's button goes inside), or, once paid, its receipt. The chat and the cart both use it, so an
// order always looks like an order and never like one more chat message.

import { useEffect, useState, type ReactNode } from 'react';
import type { BuyerOrder } from '@/core/buyer-orders.ts';
import { ORDER_STATE_LABEL } from '@/core/order-words.ts';
import { callApi } from './api.ts';

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
  /** The order's link (/order/<cartId>) once paid; its status there is the live one. */
  cartId?: string;
}

/** Where a paid order stands now, from the shop (shipped, refunded...), once the card is shown. */
function useLiveOrder(cartId?: string): BuyerOrder | undefined {
  const [order, setOrder] = useState<BuyerOrder>();
  useEffect(() => {
    if (!cartId) return;
    let gone = false;
    callApi<BuyerOrder>(`/api/orders/${cartId}`, 'GET')
      .then((o) => !gone && setOrder(o))
      .catch(() => undefined); // offline or not found: the receipt keeps what it knew
    return () => {
      gone = true;
    };
  }, [cartId]);
  return order;
}

/** `onCancel`: a cart not paid yet can be dropped. `onDismiss`: a receipt can be put away. */
export function PurchaseCard({ data: given, state, children, onCancel, onDismiss }: { data: Purchase; state: 'ready' | 'paid'; children?: ReactNode; onCancel?: () => void; onDismiss?: () => void }) {
  const paid = state === 'paid';
  const live = useLiveOrder(paid ? given.cartId : undefined);
  const data: Purchase = live
    ? {
        ...given,
        order: live.number,
        status: [live.status, live.tracking ? `Tracking: ${live.tracking.carrier} ${live.tracking.number}.` : '']
          .filter(Boolean)
          .join(' '),
      }
    : given;
  return (
    <section className={`purchase purchase-${state}`} aria-label={paid ? `Receipt${data.order ? ` for order ${data.order}` : ''}` : 'Cart ready to pay'}>
      <header className="purchase-head">
        <span className="purchase-badge">
          <span aria-hidden="true">{paid ? '✓' : '●'}</span> {paid ? ORDER_STATE_LABEL[live?.state ?? 'paid'] : 'Ready to pay'}
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
        {paid && data.cartId && (
          <a className="purchase-track" href={`/order/${data.cartId}`}>
            Track this order →
          </a>
        )}
        {children}
      </div>
    </section>
  );
}
