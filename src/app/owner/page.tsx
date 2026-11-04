// Overview: the one job first (what's waiting for the owner), then what Sayso noticed and a short setup
// checklist while the shop isn't fully set up. Then the week: four headline numbers against the week
// before, what the shop's agents did with its money, the latest orders and revenue by day, and the whole
// story in depth (AG Studio): every request and what Guard did, sales by channel, each order's money trail.
import { actionAmount } from '@/core/guard/describe.ts';
import { ConnectPayouts, Decision, KeepPrice, PublishButton, ShopName } from '@/app/_components/owner-actions.tsx';
import { actionLabel, Icon, Status, Who } from '@/app/_components/ui.tsx';
import { Ago } from '@/app/_components/time.tsx';
import { pricesToConfirm } from '@/core/catalog.ts';
import { formatMoney, toMoney } from '@/core/money.ts';
import { ChannelBadge, Thumb } from '@/app/_components/owner-bits.tsx';
import { KpiCard, SaysoBar } from '@/app/_components/metrics.tsx';
import { RevenueChart } from '@/app/_components/revenue-chart.tsx';
import { TrustReportView } from '@/app/_components/trust-report-view.tsx';
import { findVariant } from '@/core/catalog.ts';
import { decimalsFor } from '@/core/money.ts';
import { shopMetrics } from '@/core/shop-metrics.ts';
import { trustReport } from '@/core/trust-report.ts';
import { ownerView, pendingFor } from '@/server/owner.ts';

/** What PayPal's payout onboarding came back with, as /owner?payouts=... */
const PUBLISHED: Record<string, string> = {
  '1': 'Your shop is live. Shoppers on Sayso and their assistants can buy from it now.',
  failed: "You're signed in, but publishing didn't go through. Check your prices below and publish again.",
};

const PAYOUT_OUTCOMES: Record<string, string> = {
  connected: 'Your PayPal is connected. New sales are paid straight into it.',
  pending: "PayPal hasn't finished connecting your account yet. If you closed PayPal early, connect again.",
  incomplete: "PayPal connected the account, but without everything Sayso needs to take payments and refund them for you. Connect again and allow both.",
  failed: 'Something went wrong while checking with PayPal. Please try again.',
};

export default async function Overview({ searchParams }: { searchParams: Promise<{ payouts?: string; published?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { shop, shopId, orders: shopOrders, catalog, redact, saySo, payouts, demo } = view;
  const asked = await searchParams;
  const outcome = PAYOUT_OUTCOMES[asked.payouts ?? ''] ?? PUBLISHED[asked.published ?? ''];
  const onTour = shop.visibility === 'private';
  const [approvals, orders, { suggestions }, passkey, devices, records, policy] = await Promise.all([
    pendingFor(shopId),
    shopOrders.list(shopId),
    saySo.autonomy(shopId),
    view.passkeys.required(shopId),
    view.push.list(shopId),
    saySo.audit(shopId, 2000),
    saySo.policy(shopId),
  ]);
  const refundRule = policy.rules.find((r) => r.type === 'max_amount' && r.kinds.includes('refund.create'));
  const report = trustReport(records, orders, shop.currency, refundRule?.type === 'max_amount' ? refundRule.limit : undefined);
  const minorPerUnit = 10 ** decimalsFor(shop.currency);
  const week = shopMetrics(orders, report.decisions, minorPerUnit);
  // The shared demo shows people's details masked, as everywhere else in it.
  const inDepth = { ...report, decisions: report.decisions.map((d) => ({ ...d, why: redact(d.why) })), trail: report.trail.map((t) => ({ ...t, buyer: redact(t.buyer) })) };
  const pictureOf = (variantId?: string) => {
    const found = variantId ? findVariant(catalog, variantId) : undefined;
    return found?.product.imageUrl;
  };
  const drafts = catalog.drafts?.length ?? 0;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const unconfirmed = pricesToConfirm(catalog);
  const low = catalog.products.flatMap((p) => p.variants).filter((v) => v.madeToOrderDays === undefined && v.inventory <= 1).length;
  const recent = orders.filter((o) => o.number).slice(0, 5);
  const isDraft = (shop.status ?? 'live') === 'draft';

  // Setting up is one short checklist, not a stack of notices. Done steps stay ticked until all are done.
  const setup: { key: string; title: string; note: string; done: boolean; action?: React.ReactNode }[] = [];
  if (!demo) {
    setup.push({
      key: 'publish',
      title: isDraft ? 'Publish your shop' : 'Your shop is live',
      note: isDraft ? (unconfirmed.length ? 'Confirm the prices below, then publish so AI shoppers can buy.' : 'Publishing registers it with PayPal and opens it to AI shoppers.') : 'AI shoppers can find and buy from it.',
      done: !isDraft,
      action: <PublishButton />,
    });
    if (drafts > 0)
      setup.push({
        key: 'drafts',
        title: `Price ${drafts} product${drafts === 1 ? '' : 's'} from your photos`,
        note: 'Buyers don’t see them until you set a price.',
        done: false,
        action: (
          <a className="btn btn-small" href="/owner/catalog/new">
            Set prices
          </a>
        ),
      });
    if (payouts.enabled && !onTour)
      setup.push({
        key: 'payouts',
        title: shop.payout ? 'Sales go straight into your PayPal' : 'Get paid into your own PayPal',
        note: shop.payout ? `PayPal account ${shop.payout.merchantId.slice(-4).padStart(8, '•')}. Sayso never holds your money.` : 'Sales go to the sandbox account until you connect yours. You allow taking payments and refunds, nothing else.',
        done: Boolean(shop.payout),
        action: <ConnectPayouts />,
      });
    setup.push({
      key: 'phone',
      title: passkey && devices.length > 0 ? 'Approvals are on your phone' : 'Approve from your phone',
      note: passkey && devices.length > 0 ? 'A ping when an agent needs you; your fingerprint or face says OK.' : 'Get a ping when an agent needs you, and say OK with your fingerprint or face.',
      done: Boolean(passkey && devices.length > 0),
      action: (
        <a className="btn btn-small" href="/owner/phone">
          Set it up
        </a>
      ),
    });
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Overview</h1>
          <ShopName name={shop.name} readOnly={demo} />
        </div>
      </div>

      {outcome && <div className={`callout small ${shop.payout ? 'callout-say' : ''}`}>{outcome}</div>}

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
                    {actionAmount(r.action) && <span className="amount-md">{actionAmount(r.action)}</span>}
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

      {suggestions.length > 0 && (
        <a className="nudge" href="/owner/rules#earned">
          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
            <span className="small nudge-label">Sayso noticed</span>
            <b>{suggestions[0].title}?</b>
            <span className="small soft">{suggestions[0].evidence}</span>
          </span>
          <span className="btn btn-small">Review</span>
        </a>
      )}

      {setup.some((step) => !step.done) && (
        <section className="block" aria-labelledby="setup">
          <div className="block-head">
            <h2 id="setup">Finish setting up</h2>
            <span className="note">
              {setup.filter((step) => step.done).length} of {setup.length} done
            </span>
          </div>
          <ol className="list setup">
            {setup.map((step, i) => (
              <li key={step.key} className={step.done ? 'setup-done' : undefined}>
                <span className="setup-mark" aria-hidden="true">
                  {step.done ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <b>{step.title}</b>
                  <span className="small soft">{step.note}</span>
                </span>
                {!step.done && step.action}
              </li>
            ))}
          </ol>
        </section>
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

      <section className="block" aria-labelledby="week">
        <div className="block-head">
          <h2 id="week">This week</h2>
          <span className="note">The last {week.days} days, against the {week.days} before{low ? ` · ${low} item${low === 1 ? '' : 's'} low on stock` : ''}</span>
        </div>
        <div className="kpis">
          <KpiCard label="Revenue" value={money(week.revenue.now)} kpi={week.revenue} days={week.days} />
          <KpiCard label="Orders" value={String(week.orders.now)} kpi={week.orders} days={week.days} />
          <KpiCard label="Average order" value={money(week.average.now)} kpi={week.average} days={week.days} />
          <KpiCard label="Refund rate" value={`${(week.refundRate.now / 100).toFixed(1)}%`} kpi={week.refundRate} upIsGood={false} days={week.days} />
        </div>
      </section>

      <section className="sayso-card" aria-labelledby="agents-week">
        <div className="sayso-card-head">
          <h2 id="agents-week">Your agents this week</h2>
          <span className="small muted">
            {week.sayso.requests
              ? `${week.sayso.requests} request${week.sayso.requests === 1 ? '' : 's'} for your money. Guard decided each one before PayPal moved anything.`
              : 'No agent has asked to move money this week.'}
          </span>
        </div>
        <SaysoBar sayso={week.sayso} format={money} />
      </section>

      <div className="overview-split">
        <section className="panel-card" aria-labelledby="recent">
          <div className="panel-card-head">
            <h2 id="recent">Latest orders</h2>
            {recent.length > 0 && <a className="small" href="/owner/orders">All orders</a>}
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              <b>No orders yet.</b>
              <span className="small">
                Share your shop&apos;s MCP link with an AI assistant, or send buyers to <a href={`/shop/${shop.slug}`}>your shop page</a>.
              </span>
            </div>
          ) : (
            <ul className="order-list">
              {recent.map((o) => (
                <li key={o.id}>
                  <a href={`/owner/orders/${o.id}`}>
                    <Thumb src={pictureOf(o.items[0]?.variant_id)} />
                    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <span className="row" style={{ gap: 'var(--s2)', flexWrap: 'nowrap', minWidth: 0 }}>
                        <b className="mono order-no">{o.number}</b>
                        <ChannelBadge channel={o.channel} />
                      </span>
                      <span className="small soft order-items">{o.items.map((i) => `${i.quantity}× ${i.name ?? i.variant_id}`).join(', ')}</span>
                    </span>
                    <span className="stack order-right">
                      <span className="num" style={{ fontWeight: 650 }}>{o.total}</span>
                      <Status value={o.status} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel-card" aria-labelledby="revenue">
          <div className="panel-card-head">
            <h2 id="revenue">Revenue, day by day</h2>
            <span className="small muted">Last {week.days * 2} days</span>
          </div>
          <RevenueChart daily={week.daily} currency={shop.currency} minorPerUnit={minorPerUnit} />
        </section>
      </div>

      <section className="block" aria-labelledby="depth">
        <div className="block-head">
          <h2 id="depth">In depth</h2>
          <span className="note">Every request, every sale, every money move, checked against PayPal · AG Studio</span>
        </div>
        <TrustReportView data={inDepth} licenseKey={process.env.AG_STUDIO_LICENSE_KEY || undefined} />
      </section>
    </>
  );
}
