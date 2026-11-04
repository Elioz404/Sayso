'use client';

// The Orders tab of the shopping panel: what the buyer bought, wherever they are on the site. Orders
// their PayPal account paid for once they sign in with it, and the ones paid in this browser.

import { useEffect, useState } from 'react';
import type { BuyerOrder } from '@/core/buyer-orders.ts';
import { callApi } from './api.ts';
import { BrowserOrders } from './browser-orders.tsx';
import { OrderRow } from './order-view.tsx';

type Mine = { signedIn: boolean; who?: string; canSignIn: boolean; orders: BuyerOrder[] };

/** `active`: the tab is showing; it looks again each time, so a status that changed shows up. */
export function OrdersPanel({ active }: { active: boolean }) {
  const [mine, setMine] = useState<Mine>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active) return;
    let gone = false;
    callApi<Mine>('/api/orders/mine', 'GET')
      .then((m) => {
        if (gone) return;
        setMine(m);
        setRound((r) => r + 1);
      })
      .catch(() => !gone && setMine({ signedIn: false, canSignIn: false, orders: [] }));
    return () => {
      gone = true;
    };
  }, [active]);

  if (!mine) return <p className="small muted orders-panel">Looking for your orders…</p>;
  return (
    <div className="orders-panel">
      {mine.signedIn ? (
        <section className="stack" style={{ gap: 'var(--s2)' }}>
          <span className="small muted">Paid with your PayPal{mine.who ? ` (${mine.who})` : ''}</span>
          {mine.orders.length ? (
            <ul className="orows">
              {mine.orders.map((o) => (
                <OrderRow key={o.id} order={o} />
              ))}
            </ul>
          ) : (
            <p className="small muted">No orders paid with this PayPal account yet.</p>
          )}
        </section>
      ) : (
        mine.canSignIn && (
          <div className="orders-signin">
            <span className="small">See every order you paid with PayPal, from any browser.</span>
            <a className="btn btn-paypal btn-small" href="/api/orders/signin">
              Log in with PayPal
            </a>
          </div>
        )
      )}
      <section className="stack" style={{ gap: 'var(--s2)' }}>
        <span className="small muted">{mine.signedIn ? 'Also paid in this browser' : 'Paid in this browser'}</span>
        <BrowserOrders key={round} exclude={mine.orders.map((o) => o.id)} />
      </section>
      <a className="small cart-orders" href="/orders">
        Open My orders →
      </a>
    </div>
  );
}
