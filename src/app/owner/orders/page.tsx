import type { Metadata } from 'next';
import { OrdersGrid, type OrderRow } from '@/app/_components/grids.tsx';
import { toMinor } from '@/core/money.ts';
import { ownerView, when } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Orders' };

export default async function Orders() {
  const view = await ownerView();
  if (!view) return null;
  const { shopId, seller, carts } = view;
  const [orders, cartList] = await Promise.all([seller.orders(shopId), carts.listByShop(shopId)]);
  const totals = new Map(cartList.map((c) => [c.id, c.cart.totals?.total]));
  const placed = orders.filter((o) => o.number);
  const open = orders.length - placed.length;

  const rows: OrderRow[] = placed.map((o) => {
    const total = totals.get(o.id);
    return {
      id: o.id,
      number: o.number!,
      placed: when(o.createdAt),
      status: o.status,
      total: o.total ?? '-',
      totalMinor: total ? toMinor(total) : 0,
      refunded: o.refunded ?? '-',
      items: o.items.map((i) => `${i.quantity}x ${i.name ?? i.variant_id}`).join(', '),
      via: o.channel ?? 'unknown',
    };
  });

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Orders</h1>
          <p className="sub">
            {placed.length} placed{open ? `, ${open} cart${open === 1 ? '' : 's'} still open with shoppers` : ''}. Select an order to see its payments.
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <b>No orders yet.</b>
          <span className="small">Orders appear here as soon as a buyer approves a payment in PayPal.</span>
        </div>
      ) : (
        <OrdersGrid rows={rows} />
      )}
    </>
  );
}
