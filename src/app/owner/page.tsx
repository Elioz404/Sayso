// Overview: the one job first (what's waiting for the owner), then a single row of figures and the
// latest orders. Everything else lives in its own view.
import { Decision, PublishButton } from '@/app/_components/owner-actions.tsx';
import { actionLabel, Status, Who } from '@/app/_components/ui.tsx';
import { Ago } from '@/app/_components/time.tsx';
import { formatMoney } from '@/core/money.ts';
import { ownerView, pendingFor } from '@/server/owner.ts';

export default async function Overview() {
  const view = await ownerView();
  if (!view) return null;
  const { shop, shopId, orders: shopOrders, catalog } = view;
  const [approvals, orders] = await Promise.all([pendingFor(shopId), shopOrders.list(shopId)]);
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const paid = orders.filter((o) => o.status === 'paid');
  const charged = paid.reduce((sum, o) => sum + (o.totalMinor ?? 0), 0);
  const refunded = orders.reduce((sum, o) => sum + o.refundedMinor, 0);
  const low = catalog.products.flatMap((p) => p.variants).filter((v) => v.madeToOrderDays === undefined && v.inventory <= 1).length;
  const recent = orders.filter((o) => o.number).slice(0, 5);

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Overview</h1>
          <p className="sub">{shop.name}</p>
        </div>
      </div>

      {(shop.status ?? 'live') === 'draft' && (
        <div className="callout">
          <div className="stack" style={{ gap: 2 }}>
            <b>Your shop is a draft</b>
            <span className="small soft">Check the catalog, then publish to register it with PayPal and let AI shoppers buy.</span>
          </div>
          <PublishButton />
        </div>
      )}

      <section className="block" aria-labelledby="waiting">
        <div className="block-head">
          <h2 id="waiting">Waiting for your OK</h2>
          {approvals.length > 0 && <span className="note">Your agents can&apos;t approve these. Only you can.</span>}
        </div>
        {approvals.length === 0 ? (
          <div className="empty">
            <b>Nothing is waiting for you.</b>
            <span className="small">When an agent asks for something over your rules, like a big refund, it shows up here and on your phone.</span>
          </div>
        ) : (
          <ul className="list">
            {approvals.map((r) => (
              <li key={r.id} className="ask">
                <div className="ask-main">
                  <div className="ask-top">
                    <Who actor={r.action.actor} />
                    <span className="small muted">
                      <Ago iso={r.createdAt} />
                    </span>
                  </div>
                  <div className="row" style={{ gap: 'var(--s3)', alignItems: 'baseline' }}>
                    <b>{actionLabel(r.action.kind)}</b>
                    {r.action.amount !== undefined && <span className="amount-md">{formatMoney(r.action.amount, r.action.currency ?? shop.currency)}</span>}
                  </div>
                  <p className="small soft">{r.action.reason}</p>
                  <p className="ask-why">{r.decision?.hits.map((h) => h.message).join(' ')}</p>
                </div>
                <div className="ask-side">
                  <Decision id={r.id} />
                  <a className="small" href={`/approve/${r.id}`}>
                    See details
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block" aria-labelledby="figures">
        <h2 id="figures" className="sr-only">
          Figures
        </h2>
        <dl className="tally">
          <div>
            <dt>Paid orders</dt>
            <dd>{paid.length}</dd>
          </div>
          <div>
            <dt>Charged</dt>
            <dd>{money(charged)}</dd>
          </div>
          <div>
            <dt>Refunded</dt>
            <dd>{money(refunded)}</dd>
          </div>
          <div className={low ? 'hold' : undefined}>
            <dt>Low on stock</dt>
            <dd>{low ? `${low} item${low === 1 ? '' : 's'}` : 'None'}</dd>
          </div>
        </dl>
      </section>

      <section className="block" aria-labelledby="recent">
        <div className="block-head">
          <h2 id="recent">Latest orders</h2>
          {recent.length > 0 && <a href="/owner/orders">All orders</a>}
        </div>
        {recent.length === 0 ? (
          <div className="empty">
            <b>No orders yet.</b>
            <span className="small">
              Share your shop&apos;s MCP link with an AI assistant, or send buyers to <a href={`/shop/${shop.slug}`}>your shop page</a>.
            </span>
          </div>
        ) : (
          <ul className="list">
            {recent.map((o) => (
              <li key={o.id}>
                <a className="list-link" href={`/owner/orders/${o.id}`}>
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <b>{o.number}</b>
                    <span className="small soft" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.items.map((i) => `${i.quantity}x ${i.name ?? i.variant_id}`).join(', ')}
                    </span>
                  </span>
                  <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                    <span className="num" style={{ fontWeight: 650 }}>{o.total}</span>
                    <Status value={o.status} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
