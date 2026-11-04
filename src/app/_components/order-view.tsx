// A buyer's order as they see it: where it stands, what's in it, tracking and refunds. Plain components
// (no hooks), so the order page, the "My orders" list and the list of this browser's orders share them.

import type { BuyerOrder } from '@/core/buyer-orders.ts';
import { When } from './time.tsx';

const TONE: Record<BuyerOrder['state'], string> = { paid: 'ok', shipped: 'ok', waiting: 'hold', refunded: 'quiet', cancelled: 'quiet' };
const WORD: Record<BuyerOrder['state'], string> = { paid: 'Preparing', shipped: 'Shipped', waiting: 'Waiting for the shop', refunded: 'Refunded', cancelled: 'Cancelled' };

export function OrderState({ state }: { state: BuyerOrder['state'] }) {
  return <span className={`status status-${TONE[state]}`}>{WORD[state]}</span>;
}

/** Paid, preparing, shipped: done steps filled, the next one marked as where it is now. */
export function OrderSteps({ order }: { order: BuyerOrder }) {
  if (!order.steps.length) return null;
  const now = order.steps.findIndex((s) => !s.done);
  return (
    <ol className="osteps" aria-label="Where your order is">
      {order.steps.map((s, i) => (
        <li key={s.label} className={s.done ? 'osteps-done' : i === now ? 'osteps-now' : undefined}>
          <span className="osteps-dot" aria-hidden="true">
            {s.done ? '✓' : ''}
          </span>
          <span className="osteps-label">
            <b>{s.label}</b>
            {s.at && (
              <small className="muted">
                <When iso={s.at} />
              </small>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One order in a list: photo, number, shop, when, total and where it stands; the whole row opens it. */
export function OrderRow({ order }: { order: BuyerOrder }) {
  const photo = order.items.find((i) => i.image)?.image;
  const pieces = order.items.reduce((n, i) => n + i.qty, 0);
  return (
    <li>
      <a className="orow" href={`/order/${order.id}`}>
        <span className="orow-photo">{photo && <img src={photo} alt="" loading="lazy" />}</span>
        <span className="orow-main">
          <b>{order.items.map((i) => i.name).filter((n, k, all) => all.indexOf(n) === k).join(', ')}</b>
          <span className="small muted">
            {order.shop.name} · <span className="mono">{order.number}</span> · {pieces} piece{pieces === 1 ? '' : 's'} · <When iso={order.placedAt} />
          </span>
        </span>
        <span className="orow-end">
          <b className="num">{order.total}</b>
          <OrderState state={order.state} />
          {order.refundPending && <span className="small muted">Refund asked</span>}
        </span>
      </a>
    </li>
  );
}
