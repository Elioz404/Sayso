'use client';

// Orders paid in this browser (through the assistant or the cart), found from what this browser kept,
// with where each one stands now. The ones already listed from the buyer's PayPal sign-in are left out.

import { useEffect, useState } from 'react';
import type { BuyerOrder } from '@/core/buyer-orders.ts';
import { callApi } from './api.ts';
import { OrderRow } from './order-view.tsx';

/** Cart ids of orders paid in this browser: the assistant's paid carts and the cart's receipts. */
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

export function BrowserOrders({ exclude = [] }: { exclude?: string[] }) {
  const [orders, setOrders] = useState<BuyerOrder[]>();
  useEffect(() => {
    const ids = ordersInThisBrowser().filter((id) => !exclude.includes(id));
    void Promise.all(ids.map((id) => callApi<BuyerOrder>(`/api/orders/${id}`, 'GET').catch(() => undefined))).then((found) =>
      setOrders(found.filter((o): o is BuyerOrder => Boolean(o)).sort((a, b) => b.placedAt.localeCompare(a.placedAt))),
    );
    // `exclude` comes from the server once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!orders) return <p className="small muted">Looking for orders paid in this browser…</p>;
  if (!orders.length) return <p className="small muted">No other orders were paid in this browser.</p>;
  return (
    <ul className="orows">
      {orders.map((o) => (
        <OrderRow key={o.id} order={o} />
      ))}
    </ul>
  );
}
