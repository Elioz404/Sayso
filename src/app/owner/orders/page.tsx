import type { Metadata } from 'next';
import { OrdersGrid, type OrderRow } from '@/app/_components/grids.tsx';
import { toMinor } from '@/core/money.ts';
import { ownerView, when } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Orders' };

const INVOICE_TONE: Record<string, 'ok' | 'hold' | 'stop'> = {
  paid: 'ok',
  'marked as paid': 'ok',
  'partially paid': 'hold',
  sent: 'hold',
  unpaid: 'hold',
  'waiting for the owner': 'hold',
  denied: 'stop',
  rejected: 'stop',
  failed: 'stop',
  cancelled: 'stop',
};

export default async function Orders() {
  const view = await ownerView();
  if (!view) return null;
  const { shopId, seller, carts } = view;
  const [orders, cartList, invoices] = await Promise.all([seller.orders(shopId), carts.listByShop(shopId), seller.invoices(shopId)]);
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

      <section className="block" aria-labelledby="invoices">
        <div className="block-head">
          <h2 id="invoices">Invoices for custom orders</h2>
          <span className="note">Status comes live from PayPal.</span>
        </div>
        {invoices.length === 0 ? (
          <div className="empty">
            <b>No invoices yet.</b>
            <span className="small">
              When a buyer agrees a commission in a DM, your agent sends the invoice: <span className="mono">sayso invoice grace@example.com &quot;Custom vase&quot; 62.00 --deposit 31.00</span>
            </span>
          </div>
        ) : (
          <ul className="list">
            {invoices.map((i) => (
              <li key={i.say_so_id} className="spread">
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <b>
                    {i.number ? `Invoice ${i.number}` : 'Invoice'} · {i.to}
                  </b>
                  <span className="small soft">{i.items}</span>
                </span>
                <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                  <span className="num" style={{ fontWeight: 650 }}>
                    {i.total}
                  </span>
                  <span className={`status status-${INVOICE_TONE[i.status] ?? 'quiet'}`}>{i.status.charAt(0).toUpperCase() + i.status.slice(1)}</span>
                  {i.payer_url ? (
                    <a className="small" href={i.payer_url}>
                      Payment page
                    </a>
                  ) : (
                    <a className="small" href={`/approve/${i.say_so_id}`}>
                      Details
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
