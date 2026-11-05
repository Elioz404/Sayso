// One order, as the owner works it: where it stands (the same steps the buyer sees), the one thing to do
// next if there is one, what was bought, who it goes to, and every money movement on it.
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { actionAmount } from '@/core/guard/describe.ts';
import type { Metadata } from 'next';
import { LabelScanner } from '@/app/_components/label-scanner.tsx';
import { OrderSteps } from '@/app/_components/order-view.tsx';
import { When } from '@/app/_components/time.tsx';
import { actionLabel, Icon, Status, toneOf } from '@/app/_components/ui.tsx';
import { orderView } from '@/core/buyer-orders.ts';
import { HttpError } from '@/core/errors.ts';
import { formatMoney, toMinor } from '@/core/money.ts';
import { trackingLink } from '@/core/shipping.ts';
import { channelName } from '@/core/trust-report.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Order' };

/** Where the order stands, in the owner's words. */
const STATE: Record<string, { label: string; tone: string }> = {
  paid: { label: 'Paid, to ship', tone: 'hold' },
  waiting: { label: 'Waiting for your OK', tone: 'hold' },
  shipped: { label: 'Shipped', tone: 'ok' },
  'refund-asked': { label: 'Refund waiting for you', tone: 'hold' },
  refunded: { label: 'Refunded', tone: 'quiet' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
};

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { id } = await params;
  const { shopId, orders, demo, redact } = view;
  const found = await orders.get(shopId, id).catch((err: unknown) => {
    if (err instanceof HttpError && err.status === 404) return undefined;
    throw err;
  });
  if (!found) notFound();
  const { order, cart, records } = found;
  const totals = cart.cart.totals;
  const money = (m?: { value: string; currency_code: string }) => (m ? formatMoney(toMinor(m), m.currency_code) : '-');
  const address = cart.cart.shipping_address;
  const history = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // The same progress line the buyer sees on their order page.
  const progress = order.number ? orderView(view.links, cart, records, view.catalog, { owner: true }) : undefined;
  const state = progress ? STATE[progress.state] : undefined;
  const waiting = records.filter((r) => r.status === 'pending_approval');
  const capture = waiting.find((r) => r.action.kind === 'payment.capture');
  const refundAsk = waiting.find((r) => r.action.kind === 'refund.create');
  const toShip = order.status === 'paid' && !order.tracking && !refundAsk && progress?.state !== 'refunded';

  return (
    <>
      <div className="stack" style={{ gap: 'var(--s3)' }}>
        <Link href="/owner/orders" className="small row" style={{ gap: 4 }}>
          <Icon name="back" size={14} /> All orders
        </Link>
        <div className="view-head">
          <div>
            <h1>{order.number ?? order.id}</h1>
            <p className="sub">
              {order.total} · placed <When iso={order.createdAt} /> · via {channelName(order.channel)}
            </p>
          </div>
          {state ? <span className={`status status-${state.tone}`}>{state.label}</span> : <Status value={order.status} />}
        </div>
      </div>

      {progress && progress.steps.length > 0 && (
        <section className="order-card" aria-label="Where this order is">
          <OrderSteps order={progress} />
        </section>
      )}

      {/* The one thing to do next, if there is one. */}
      {capture && (
        <section className="callout" aria-label="Next step">
          <span className="small">
            <b>Waiting for your OK to charge {actionAmount(capture.action)}.</b> Your rules hold this order; the buyer isn&apos;t charged until you say OK.
          </span>
          <a className="btn btn-small" href={`/approve/${capture.id}`}>
            Review
          </a>
        </section>
      )}
      {refundAsk && (
        <section className="callout" aria-label="Next step">
          <span className="small">
            <b>
              {refundAsk.action.actor.side === 'buyer' ? 'The buyer asked for a refund' : 'Your agent asks to refund'}
              {actionAmount(refundAsk.action) ? ` ${refundAsk.action.actor.side === 'buyer' ? 'of ' : ''}${actionAmount(refundAsk.action)}` : ''}.
            </b> &ldquo;{redact(refundAsk.action.reason)}&rdquo;
          </span>
          <a className="btn btn-small" href={`/approve/${refundAsk.id}`}>
            Review
          </a>
        </section>
      )}
      {toShip && (
        <section className="panel order-ship" aria-labelledby="ship">
          <div className="stack" style={{ gap: 'var(--s3)' }}>
            <h2 id="ship" className="h3">
              Next: ship it
            </h2>
            <p className="small soft">The buyer has paid. You pack and send it yourself; Sayso and PayPal don&apos;t handle the parcel.</p>
            <ol className="ship-steps small">
              <li>
                <b>Pack it and buy a label</b> from your carrier (USPS, UPS, FedEx…), at the post office or on their site.
              </li>
              <li>
                <b>Add the tracking number</b> printed on that label below. Or take a photo of the label and Sayso reads the carrier and number for you.
              </li>
              <li>
                <b>Mark as shipped.</b> PayPal shows the buyer where the parcel is, and the order moves to Shipped.
              </li>
            </ol>
          </div>
          {demo ? <p className="small muted">The shared demo shop doesn&apos;t ship.</p> : <LabelScanner orderId={order.id} />}
        </section>
      )}

      <div className="detail-grid">
        <div className="stack" style={{ gap: 'var(--s6)' }}>
          <section className="block" aria-labelledby="items">
            <h2 id="items" className="h3">
              Items
            </h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  {cart.cart.items.map((i) => (
                    <tr key={i.variant_id}>
                      <td>{i.name}</td>
                      <td className="num soft">×{i.quantity}</td>
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

          <section className="block" aria-labelledby="history">
            <div className="block-head">
              <h2 id="history" className="h3">
                Money movements
              </h2>
              <span className="note">Each one checked against PayPal and recorded.</span>
            </div>
            <ol className="timeline">
              {history.map((r) => (
                <li key={r.id} className={toneOf(r.status)}>
                  <span className="stack" style={{ gap: 2 }}>
                    <span className="row" style={{ gap: 'var(--s3)' }}>
                      <b>
                        {actionLabel(r.action.kind)}
                        {actionAmount(r.action) ? ` ${actionAmount(r.action)}` : ''}
                      </b>
                      <Status value={r.status} />
                    </span>
                    <span className="small soft">{redact(r.action.reason)}</span>
                    <span className="small muted">
                      <When iso={r.createdAt} /> · <a href={`/approve/${r.id}`}>details</a>
                    </span>
                  </span>
                </li>
              ))}
              {history.length === 0 && <li className="small soft">Nothing has moved yet.</li>}
            </ol>
          </section>
        </div>

        <section className="panel" aria-labelledby="buyer">
          <h2 id="buyer" className="h3">
            Buyer and delivery
          </h2>
          <dl className="kv kv-stack" style={{ marginTop: 'var(--s3)' }}>
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
            <dt>Tracking</dt>
            <dd>
              {order.tracking ? (
                <span className="stack" style={{ gap: 2 }}>
                  <span>
                    {order.tracking.carrier} <span className="mono">{order.tracking.number}</span>
                  </span>
                  {trackingLink(order.tracking.carrier, order.tracking.number) && (
                    <a className="small" href={trackingLink(order.tracking.carrier, order.tracking.number)} target="_blank" rel="noopener noreferrer">
                      Track the parcel ↗
                    </a>
                  )}
                </span>
              ) : (
                'Not shipped yet'
              )}
            </dd>
            <dt>Paid into</dt>
            <dd>{order.paidToOwner ? 'Your PayPal account' : "Sayso's sandbox account"}</dd>
            <dt>PayPal order</dt>
            <dd className="mono">{cart.orderId ?? '-'}</dd>
          </dl>
        </section>
      </div>
    </>
  );
}
