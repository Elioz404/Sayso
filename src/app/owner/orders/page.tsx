import type { Metadata } from 'next';
import { OrdersGrid, type OrderRow } from '@/app/_components/grids.tsx';
import { Status } from '@/app/_components/ui.tsx';
import { findVariant } from '@/core/catalog.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Orders' };

export default async function Orders() {
  const view = await ownerView();
  if (!view) return null;
  const { shopId, orders: shopOrders, invoicing, redact, catalog, demo } = view;
  const [placed, open, invoices] = await Promise.all([shopOrders.list(shopId), shopOrders.openCarts(shopId), invoicing.list(shopId)]);

  const rows: OrderRow[] = placed.map((o) => ({
    id: o.id,
    number: o.number!,
    placed: o.createdAt,
    status: o.status,
    total: o.total ?? '-',
    totalMinor: o.totalMinor ?? 0,
    refunded: o.refunded ?? '-',
    refundedMinor: o.refundedMinor,
    items: o.items.map((i) => `${i.quantity}× ${i.name ?? i.variant_id}`).join(', '),
    via: o.channel ?? '',
    ...(o.buyer ? { buyer: redact(o.buyer) } : {}),
    ...(() => {
      const photo = o.items[0]?.variant_id ? findVariant(catalog, o.items[0].variant_id)?.product.imageUrl : undefined;
      return photo ? { image: photo } : {};
    })(),
    ...(o.tracking ? { shipping: `${o.tracking.carrier} · ${o.tracking.number}` } : {}),
  }));

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
                    {i.number ? `Invoice ${i.number}` : 'Invoice'} · {redact(i.to)}
                  </b>
                  <span className="small soft">{i.items}</span>
                </span>
                <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                  <span className="num" style={{ fontWeight: 650 }}>
                    {i.total}
                  </span>
                  <Status value={i.status} />
                  {i.payer_url && !demo ? (
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
