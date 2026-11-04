// A buyer's order, at its own link: where it stands (paid, preparing, shipped), what's in it, tracking,
// refunds, and a way to ask the shop for one. No account: the link is the key (the same one an assistant's
// get_cart takes), and signing in with PayPal lists every order from any browser.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import QRCode from 'qrcode';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { OrderState, OrderSteps } from '@/app/_components/order-view.tsx';
import { When } from '@/app/_components/time.tsx';
import { buyerOrder } from '@/core/buyer-orders.ts';
import { buyerSession, ownsOrder } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Your order', robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { carts, catalogs, orders, links } = await ready();
  const order = await buyerOrder({ carts, catalogs, orders, links }, (await params).id);
  if (!order) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>No order here</h1>
        <p className="soft">
          This link doesn&apos;t match an order. If you paid with PayPal, <a href="/orders">find your orders</a> by signing in with that account.
        </p>
      </main>
    );
  }
  const signedIn = Boolean(await buyerSession());
  // The buyer (paid in this browser, or signed in with the PayPal that paid) may ask for a refund; a link
  // alone only shows the order.
  const owns = await ownsOrder(carts, order.id);
  const url = `${links.base}/order/${order.id}`;
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#221c17', light: '#00000000' } });

  return (
    <main className="wrap wrap-narrow page order-page">
      <a className="small" href="/orders">
        ← My orders
      </a>
      <header className="order-head">
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <h1>
            Order <span className="mono">{order.number}</span>
          </h1>
          <span className="soft small">
            From {order.shop.url ? <a href={order.shop.url}>{order.shop.name}</a> : order.shop.name} · placed <When iso={order.placedAt} />
          </span>
        </div>
        <OrderState state={order.state} />
      </header>

      <section className="order-card" aria-label="Where your order is">
        <OrderSteps order={order} />
        <p className="order-status">{order.status}</p>
        {order.tracking && (
          <div className="order-track">
            <span>
              {order.tracking.carrier} <span className="mono">{order.tracking.number}</span>
            </span>
            {order.tracking.url && (
              <a className="btn btn-small" href={order.tracking.url} target="_blank" rel="noopener noreferrer">
                Track the parcel ↗
              </a>
            )}
          </div>
        )}
      </section>

      <section className="order-card" aria-labelledby="in-it">
        <h2 id="in-it" className="sr-only">
          What you ordered
        </h2>
        <ul className="purchase-lines">
          {order.items.map((i, k) => (
            <li key={k}>
              <span className="purchase-thumb">{i.image && <img src={i.image} alt="" loading="lazy" />}</span>
              <span className="purchase-name">
                {i.url ? <a href={i.url}>{i.name}</a> : <span>{i.name}</span>}
                {i.detail && <span className="small muted">{i.detail}</span>}
              </span>
              <span className="small muted">×{i.qty}</span>
              <span className="num">{i.amount}</span>
            </li>
          ))}
        </ul>
        <dl className="purchase-totals">
          {order.subtotal && (
            <>
              <dt>Subtotal</dt>
              <dd>{order.subtotal}</dd>
            </>
          )}
          {order.shipping && (
            <>
              <dt>Shipping</dt>
              <dd>{order.shipping}</dd>
            </>
          )}
          {order.tax && (
            <>
              <dt>Tax</dt>
              <dd>{order.tax}</dd>
            </>
          )}
          <dt className="purchase-total">{order.state === 'waiting' ? 'Total, authorized' : order.state === 'cancelled' ? 'Total, not charged' : 'Total paid'}</dt>
          <dd className="purchase-total">{order.total}</dd>
          {order.refunded && (
            <>
              <dt>Refunded to you</dt>
              <dd className="refund">−{order.refunded}</dd>
            </>
          )}
        </dl>
      </section>

      {(order.refundRequests.length > 0 || order.canAskRefund) && (
        <section className="order-card" aria-labelledby="refunds">
          <h2 id="refunds" className="h3">
            Refunds
          </h2>
          {order.refundRequests.length > 0 && (
            <ul className="order-requests">
              {order.refundRequests.map((r, k) => (
                <li key={k}>
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <b>{r.amount}</b>
                    {r.reason && <span className="small soft">&ldquo;{r.reason}&rdquo;</span>}
                  </span>
                  <span className="small">
                    {r.status} · <When iso={r.askedAt} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {order.canAskRefund && !owns && (
            <p className="small soft">
              To ask for a refund, <a href={`/api/orders/signin?next=/order/${order.id}`}>log in with the PayPal account that paid</a>. Anyone with this
              link can see the order, but only you can ask for your money back.
            </p>
          )}
          {order.canAskRefund && owns && (
            <div className="order-ask">
              {/* Opens Sayso's assistant with this order: it asks what happened and takes it to the shop. */}
              <a className="btn" href={`/assistant?ask=${encodeURIComponent(`I'd like a refund for order ${order.number}.`)}`}>
                Ask for a refund
              </a>
              <span className="small muted">The assistant asks what happened and sends it to the shop. The owner decides.</span>
            </div>
          )}
        </section>
      )}

      <section className="order-card order-phone" aria-labelledby="phone">
        <div className="handoff-qr" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label="QR code that opens this order on a phone" />
        <div className="stack" style={{ gap: 'var(--s2)', minWidth: 0, flex: 1 }}>
          <h2 id="phone" className="h3">
            On your phone
          </h2>
          <p className="small soft">Scan it, or copy the link: it opens this order anywhere, to see where it is. Only you can ask for a refund.</p>
          <CopyField value={url} />
        </div>
      </section>

      {!signedIn && (
        <p className="small muted">
          Want every order in one place, on any device? <a href="/orders">Log in with PayPal on My orders</a>.
        </p>
      )}
    </main>
  );
}
