// Overview: the one job first (what's waiting for the owner), then a single row of figures and the
// latest orders. Everything else lives in its own view.
import { ConnectPayouts, Decision, KeepPrice, PublishButton } from '@/app/_components/owner-actions.tsx';
import { actionLabel, Icon, Status, Who } from '@/app/_components/ui.tsx';
import { Ago } from '@/app/_components/time.tsx';
import { pricesToConfirm } from '@/core/catalog.ts';
import { formatMoney, toMoney } from '@/core/money.ts';
import { ownerView, pendingFor } from '@/server/owner.ts';

/** What PayPal's payout onboarding came back with, as /owner?payouts=... */
const PAYOUT_OUTCOMES: Record<string, string> = {
  connected: 'Your PayPal is connected. New sales are paid straight into it.',
  pending: "PayPal hasn't finished connecting your account yet. If you closed PayPal early, connect again.",
  incomplete: "PayPal connected the account, but without everything Sayso needs to take payments and refund them for you. Connect again and allow both.",
  failed: 'Something went wrong while checking with PayPal. Please try again.',
};

export default async function Overview({ searchParams }: { searchParams: Promise<{ payouts?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { shop, shopId, orders: shopOrders, catalog, redact, saySo, payouts, demo } = view;
  const outcome = PAYOUT_OUTCOMES[(await searchParams).payouts ?? ''];
  const onTour = shop.visibility === 'private';
  const [approvals, orders, { suggestions }, passkey, devices] = await Promise.all([pendingFor(shopId), shopOrders.list(shopId), saySo.autonomy(shopId), view.passkeys.required(shopId), view.push.list(shopId)]);
  const drafts = catalog.drafts?.length ?? 0;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const unconfirmed = pricesToConfirm(catalog);
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

      {!demo && (!passkey || devices.length === 0) && (
        <div className="callout callout-phone">
          <Icon name="phone" size={22} />
          <div className="stack" style={{ gap: 2 }}>
            <b>Take your shop to your phone</b>
            <span className="small soft">
              {passkey ? 'Turn on notifications so you know the moment an agent needs you.' : 'Get a ping when an agent needs you, and approve with your fingerprint or face, so no one else can say OK for you.'}
            </span>
          </div>
          <a className="btn btn-small" href="/owner/phone">
            Set it up
          </a>
        </div>
      )}

      {drafts > 0 && (
        <div className="callout">
          <span className="small">
            <b>
              {drafts} product{drafts === 1 ? '' : 's'} from your photos {drafts === 1 ? 'is' : 'are'} waiting for a price.
            </b>{' '}
            Buyers don’t see {drafts === 1 ? 'it' : 'them'} yet.
          </span>
          <a className="btn btn-small" href="/owner/catalog/new">
            Set prices
          </a>
        </div>
      )}

      {(shop.status ?? 'live') === 'draft' && (
        <div className="callout">
          <div className="stack" style={{ gap: 2 }}>
            <b>Your shop is a draft</b>
            <span className="small soft">
              {unconfirmed.length
                ? 'Confirm the prices below, check the catalog, then publish to register it with PayPal and let AI shoppers buy.'
                : 'Check the catalog, then publish to register it with PayPal and let AI shoppers buy.'}
            </span>
          </div>
          <PublishButton />
        </div>
      )}

      {unconfirmed.length > 0 && (
        <section className="block" aria-labelledby="confirm">
          <div className="block-head">
            <h2 id="confirm">Prices to confirm</h2>
            <a className="note" href="/owner/catalog">
              Set your own in Catalog
            </a>
          </div>
          <ul className="list">
            {unconfirmed.map(({ product, variant }) => {
              const s = variant.priceToConfirm?.suggested;
              return (
                <li key={variant.id} className="spread confirm-row">
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <b>
                      {product.name}
                      {variant.title !== 'Default' ? ` (${variant.title})` : ''}
                    </b>
                    <span className="small soft">
                      {s
                        ? `Similar items sell for ${money(s.low)} to ${money(s.high)} (${s.listings} listings).`
                        : 'No price yet, and too few similar items to suggest one. Set it in Catalog.'}
                    </span>
                  </span>
                  {s && <KeepPrice variantId={variant.id} price={toMoney(variant.price, shop.currency).value} label={`Keep ${money(variant.price)}`} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {outcome && <div className={`callout small ${shop.payout ? 'callout-say' : ''}`}>{outcome}</div>}

      {payouts.enabled && !demo && !onTour && (
        <div className={`panel payouts ${shop.payout ? 'payouts-on' : ''}`}>
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <b>{shop.payout ? 'Sales are paid straight into your PayPal' : 'Get paid into your own PayPal'}</b>
            <span className="small soft">
              {shop.payout
                ? `PayPal account ${shop.payout.merchantId.slice(-4).padStart(8, '•')}. Refunds come out of it too, only with your rules or your OK. Sayso never holds your money.`
                : "Right now sales go to Sayso's sandbox account. Connect your PayPal and every sale lands in it directly; you allow Sayso to take payments and refund them for you, nothing else."}
            </span>
          </div>
          <ConnectPayouts again={Boolean(shop.payout)} />
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="callout callout-say">
          <div className="stack" style={{ gap: 2 }}>
            <b>{suggestions[0].title}?</b>
            <span className="small soft">{suggestions[0].evidence}</span>
          </div>
          <a className="btn btn-small" href="/owner/rules#earned">
            Review
          </a>
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
                  <p className="small soft">{redact(r.action.reason)}</p>
                  <p className="ask-why">{redact(r.decision?.hits.map((h) => h.message).join(' ') ?? '')}</p>
                </div>
                <div className="ask-side">
                  <Decision id={r.id} passkey={passkey} />
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
