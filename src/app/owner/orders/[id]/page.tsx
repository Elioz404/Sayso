// One order: what was bought, where it ships, and every money movement on it, in order.
import { actionAmount } from '@/core/guard/describe.ts';
import type { Metadata } from 'next';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { LabelScanner } from '@/app/_components/label-scanner.tsx';
import { When } from '@/app/_components/time.tsx';
import { actionLabel, Icon, Status, toneOf } from '@/app/_components/ui.tsx';
import { HttpError } from '@/core/errors.ts';
import type { GuardRecord } from '@/core/guard/types.ts';
import { formatMoney, toMinor } from '@/core/money.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Order' };

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { id } = await params;
  const { shopId, orders, demo, redact } = view;
  const found = await orders.get(shopId, id).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 404) return undefined;
    throw err;
  });
  if (!found) {
    return (
      <div className="stack">
        <h1>Order not found</h1>
        <a href="/owner/orders">Back to orders</a>
      </div>
    );
  }
  const { order, cart, records } = found;
  const totals = cart.cart.totals;
  const money = (m?: { value: string; currency_code: string }) => (m ? formatMoney(toMinor(m), m.currency_code) : '-');
  const address = cart.cart.shipping_address;
  const history = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <>
      <div className="stack" style={{ gap: 'var(--s3)' }}>
        <a href="/owner/orders" className="small row" style={{ gap: 4 }}>
          <Icon name="back" size={14} /> All orders
        </a>
        <div className="view-head">
          <div>
            <h1>{order.number ?? order.id}</h1>
            <p className="sub">
              Placed <When iso={order.createdAt} />
            </p>
          </div>
          <Status value={order.status} />
        </div>
      </div>

      <div className="detail-grid">
        <section className="block" aria-labelledby="items">
          <h2 id="items">Items</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                </tr>
              </thead>
              <tbody>
                {cart.cart.items.map((i) => (
                  <tr key={i.variant_id}>
                    <td>{i.name}</td>
                    <td className="num">{i.quantity}</td>
                    <td className="num">{money(i.price)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="soft">Shipping</td>
                  <td />
                  <td className="num">{money(totals?.shipping)}</td>
                </tr>
                <tr>
                  <td className="soft">Tax</td>
                  <td />
                  <td className="num">{money(totals?.tax)}</td>
                </tr>
                <tr>
                  <td>
                    <b>Total</b>
                  </td>
                  <td />
                  <td className="num">
                    <b>{money(totals?.total)}</b>
                  </td>
                </tr>
                {order.refunded && (
                  <tr>
                    <td className="soft">Refunded</td>
                    <td />
                    <td className="num" style={{ color: 'var(--stop)' }}>
                      -{order.refunded}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {order.status === 'paid' && !order.tracking && !demo && (
          <section className="block block-ship" aria-labelledby="ship">
            <h2 id="ship">Shipped it?</h2>
            <p className="small soft">Snap the label: Sayso reads the carrier and tracking number, you check them, and PayPal shows the buyer where the parcel is.</p>
            <LabelScanner orderId={order.id} />
          </section>
        )}

        <section className="block" aria-labelledby="buyer">
          <h2 id="buyer">Buyer and delivery</h2>
          <div className="panel">
            <dl className="kv kv-stack">
              <dt>Buyer</dt>
              <dd>{order.buyer ? redact(order.buyer) : 'Shared by PayPal at payment'}</dd>
              <dt>Ship to</dt>
              <dd>
                {address
                  ? // The shared demo session sees the town, not the street.
                    [demo ? undefined : address.address_line_1, address.admin_area_2, address.admin_area_1, demo ? undefined : address.postal_code, address.country_code]
                      .filter(Boolean)
                      .join(', ')
                  : '-'}
              </dd>
              <dt>Bought via</dt>
              <dd>{order.channel ?? '-'}</dd>
              <dt>Tracking</dt>
              <dd>{order.tracking ? `${order.tracking.carrier} ${order.tracking.number}` : 'Not added yet'}</dd>
              <dt>Paid into</dt>
              <dd>{order.paidToOwner ? 'Your PayPal account' : "Sayso's sandbox account"}</dd>
              <dt>PayPal order</dt>
              <dd className="mono">{cart.orderId ?? '-'}</dd>
            </dl>
          </div>
        </section>
      </div>

      <section className="block" aria-labelledby="history">
        <div className="block-head">
          <h2 id="history">Money movements</h2>
          <span className="note">Each step is checked against PayPal and recorded.</span>
        </div>
        <ol className="timeline">
          <li className="ok">
            <span className="stack" style={{ gap: 2 }}>
              <b>
                Cart priced at {money(totals?.total)}
                {order.channel ? ` by ${order.channel}` : ''}
              </b>
              <span className="small muted">
                <When iso={cart.createdAt} />
              </span>
            </span>
          </li>
          {history.map((r: GuardRecord) => (
            <li key={r.id} className={toneOf(r.status)}>
              <span className="stack" style={{ gap: 2 }}>
                <span className="row" style={{ gap: 'var(--s3)' }}>
                  <b>
                    {actionLabel(r.action.kind)}
                    {actionAmount(r.action) ? ` ${actionAmount(r.action)}` : ''}
                  </b>
                  <Status value={r.status} />
                </span>
                <span className="small soft">{r.action.reason}</span>
                <span className="small muted">
                  <When iso={r.createdAt} /> · <a href={`/approve/${r.id}`}>details</a>
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="block" aria-labelledby="act">
        <h2 id="act">Refund or ship</h2>
        <p className="small soft">Your agent handles these, inside your rules. Big refunds come back to you for an OK.</p>
        <CopyField value={`sayso refund ${order.number} <amount> --reason "..."`} />
        <CopyField value={`sayso track ${order.number} USPS <tracking number>`} />
      </section>
    </>
  );
}
