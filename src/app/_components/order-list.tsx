'use client';

// The buyer's orders as one list, newest first, for My orders and the panel's Orders tab: quick views
// (in progress, shipped, refunds, cancelled) with their counts, and a page at a time, so a long history
// stays short to scroll.

import { useEffect, useMemo, useState } from 'react';
import type { BuyerOrder } from '@/core/buyer-orders.ts';
import { callApi } from './api.ts';
import { OrderRow } from './order-view.tsx';

type Listed = { signedIn: boolean; who?: string; canSignIn: boolean; orders: BuyerOrder[] };

const VIEWS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'In progress', test: (o: BuyerOrder) => o.state === 'paid' || o.state === 'waiting' || o.state === 'refund-asked' },
  { id: 'shipped', label: 'Shipped', test: (o: BuyerOrder) => o.state === 'shipped' },
  { id: 'refunds', label: 'Refunds', test: (o: BuyerOrder) => o.state === 'refunded' || Boolean(o.refunded) || o.refundRequests.length > 0 },
  { id: 'cancelled', label: 'Cancelled', test: (o: BuyerOrder) => o.state === 'cancelled' },
] as const;

/** Links to orders this browser kept (the assistant's paid carts, the cart's receipts), for orders paid before it was remembered server-side. */
export function ordersInThisBrowser(): string[] {
  const ids = new Set<string>();
  try {
    const chat = JSON.parse(localStorage.getItem('sayso-shopper-v1') ?? 'null') as { paid?: Record<string, unknown> } | null;
    Object.keys(chat?.paid ?? {}).forEach((id) => ids.add(id));
    const receipts = JSON.parse(localStorage.getItem('sayso-receipts-v1') ?? '[]') as { cartId?: string }[];
    if (Array.isArray(receipts)) receipts.forEach((r) => r.cartId && ids.add(r.cartId));
  } catch {
    // storage off: nothing kept here
  }
  return [...ids].slice(0, 20);
}

/**
 * `pageSize`: how many show before "Show more". `active`: look again whenever it becomes true (the tab
 * opening), so a status that changed shows up. `signIn`: offer Log in with PayPal when not signed in.
 */
/** `more`: "button" shows the next page here; "link" (the panel) points to My orders instead. */
export function OrderList({ pageSize, active = true, signIn = false, more = 'button' }: { pageSize: number; active?: boolean; signIn?: boolean; more?: 'button' | 'link' }) {
  const [listed, setListed] = useState<Listed>();
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('all');
  const [shown, setShown] = useState(pageSize);
  useEffect(() => {
    if (!active) return;
    let gone = false;
    callApi<Listed>('/api/orders/list', 'POST', { here: ordersInThisBrowser() })
      .then((l) => !gone && (setListed(l), setFailed(false)))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [active]);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, listed?.orders.filter(v.test).length ?? 0])), [listed]);

  if (failed && !listed) return <p className="small muted">Your orders couldn&apos;t load right now. Try again in a moment.</p>;
  if (!listed) return <p className="small muted">Looking for your orders…</p>;
  const orders = listed.orders.filter(VIEWS.find((v) => v.id === view)!.test);
  return (
    <div className="olist">
      {signIn && !listed.signedIn && listed.canSignIn && (
        <div className="orders-signin">
          <span className="small">Your orders on any device.</span>
          <a className="btn btn-paypal btn-small" href="/api/orders/signin">
            Log in with PayPal
          </a>
        </div>
      )}
      {listed.orders.length === 0 ? (
        <p className="small muted">No orders yet.</p>
      ) : (
        <>
          {listed.orders.length > 1 && (
            <div className="dock-tabs olist-views" role="group" aria-label="Show orders">
              {VIEWS.filter((v) => v.id === 'all' || counts[v.id] > 0).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  className="dock-tab"
                  onClick={() => {
                    setView(v.id);
                    setShown(pageSize);
                  }}
                >
                  {v.label}
                  <span className="olist-count">{counts[v.id]}</span>
                </button>
              ))}
            </div>
          )}
          <ul className="orows">
            {orders.slice(0, shown).map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
          {orders.length > shown &&
            (more === 'link' ? (
              <a className="small olist-more" href="/orders">
                See all {orders.length} →
              </a>
            ) : (
              <button type="button" className="btn btn-small olist-more" onClick={() => setShown((n) => n + pageSize)}>
                Show {Math.min(pageSize, orders.length - shown)} more
              </button>
            ))}
        </>
      )}
    </div>
  );
}
