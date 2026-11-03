// The owner's dashboard. Summary first (what needs you, sales, refunds, stock), then the detail.
// Everything here is behind the owner session.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { AuditGrid, OrdersGrid, type AuditRow, type OrderRow } from '@/app/_components/grids.tsx';
import { Decision, LoginForm, NewKey, PublishButton, RevokeKey, SignOut } from '@/app/_components/owner-actions.tsx';
import { ACTION_LABEL, Icon, Status, Who } from '@/app/_components/ui.tsx';
import { describeRule } from '@/core/guard/policy-store.ts';
import { formatMoney, toMinor } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { ownerShopId } from '@/server/http.ts';

export const metadata: Metadata = { title: 'Your shop' };

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default async function Owner() {
  await connection();
  const shopId = await ownerShopId();
  if (!shopId) {
    return (
      <main className="wrap wrap-narrow stack-lg">
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Owner sign-in</span>
          <h1>Your shop, your say-so</h1>
          <p className="soft">Approve what your agents ask for, publish your catalog and manage agent keys.</p>
        </div>
        <LoginForm demo={process.env.SAYSO_DEMO === 'true'} />
        <p className="small soft">
          No shop yet? <a href="/start">Draft one from photos and a price list</a>.
        </p>
      </main>
    );
  }

  const { shops, seller, access, baseUrl, carts } = await ready();
  const catalog = await shops.get(shopId);
  const { shop } = catalog;
  const [orders, approvals, audit, policy, keys, missed, cartList] = await Promise.all([
    seller.orders(shopId),
    seller.approvals(shopId),
    seller.audit(shopId, 200),
    seller.policy(shopId),
    access.listKeys(shopId),
    seller.missedDemand(shopId),
    carts.listByShop(shopId),
  ]);
  const status = shop.status ?? 'live';
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const cartsById = new Map(cartList.map((c) => [c.id, c]));

  const paid = orders.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((sum, o) => {
    const t = cartsById.get(o.id)?.cart.totals?.total;
    return sum + (t ? toMinor(t) : 0);
  }, 0);
  const refunded = audit
    .filter((r) => r.action.kind === 'refund.create' && r.status === 'verified')
    .reduce((sum, r) => sum + (r.action.amount ?? 0), 0);
  const lowStock = catalog.products.flatMap((p) => p.variants.filter((v) => v.madeToOrderDays === undefined && v.inventory <= 1).map((v) => `${p.name} (${v.title})`));
  const liveKeys = keys.filter((k) => !k.revokedAt);

  const orderRows: OrderRow[] = orders.map((o) => {
    const total = cartsById.get(o.id)?.cart.totals?.total;
    return {
      id: o.id,
      number: o.number ?? o.id,
      created: when(o.createdAt),
      status: o.status,
      total: o.total ?? '-',
      totalMinor: total ? toMinor(total) : 0,
      refunded: o.refunded ?? '-',
      items: o.items.map((i) => `${i.quantity}x ${i.name ?? i.variant_id}`).join(', '),
      buyer: o.buyer ?? '-',
      via: o.channel ?? '-',
      tracking: o.tracking ? `${o.tracking.carrier} ${o.tracking.number}` : '-',
    };
  });
  const auditRows: AuditRow[] = audit.map((r) => ({
    id: r.id,
    at: when(r.createdAt),
    action: ACTION_LABEL[r.action.kind] ?? r.action.kind,
    amount: r.action.amount !== undefined ? formatMoney(r.action.amount, r.action.currency ?? shop.currency) : '-',
    by: r.action.actor.type === 'agent' ? `Agent: ${r.action.actor.id === 'sayso-ops-agent' ? 'Sayso checkout' : (r.action.actor.id.split(':')[1] ?? r.action.actor.id)}` : 'Owner',
    status: r.status,
    why: [...(r.decision?.hits.map((h) => h.message) ?? []), r.action.reason].filter(Boolean).join(' '),
    chain: r.chainIntact ? 'intact' : 'tampered',
  }));

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <div className="shop-head">
        <div className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">Your shop</span>
          <h1>
            {shop.name} <Status value={status} />
          </h1>
          <span className="soft small mono">{shop.slug}</span>
        </div>
        <div className="row">
          {status === 'live' && (
            <a className="btn btn-small" href={`/shop/${shop.slug}`}>
              View shop
            </a>
          )}
          <SignOut />
        </div>
      </div>

      {status === 'draft' && (
        <div className="panel panel-hold spread" style={{ marginTop: 24 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h3>Check your catalog, then publish</h3>
            <p className="soft small">Publishing registers your products with PayPal and lets AI shoppers buy them.</p>
          </div>
          <PublishButton />
        </div>
      )}

      <div className="stats" style={{ marginTop: 24 }}>
        <div className={`stat${approvals.length ? ' stat-hold' : ''}`}>
          <span className="eyebrow">Waiting for you</span>
          <span className="stat-value">{approvals.length}</span>
          <span className="small soft">{approvals.length ? <a href="#waiting">Review now</a> : 'All clear'}</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Paid orders</span>
          <span className="stat-value">{paid.length}</span>
          <span className="small soft nums">{money(revenue)} charged</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Refunded</span>
          <span className="stat-value nums">{money(refunded)}</span>
          <span className="small soft">confirmed with PayPal</span>
        </div>
        <div className="stat">
          <span className="eyebrow">Low stock</span>
          <span className="stat-value">{lowStock.length}</span>
          <span className="small soft">{lowStock.length ? 'one or none left' : 'stock looks fine'}</span>
        </div>
      </div>

      <nav className="subnav" aria-label="Sections">
        <div className="inner">
          <a href="#waiting">Waiting for you</a>
          <a href="#orders">Orders</a>
          <a href="#catalog">Catalog</a>
          <a href="#rules">Rules</a>
          <a href="#agents">Agents</a>
          <a href="#audit">Audit log</a>
        </div>
      </nav>

      <section id="waiting" className="section">
        <div className="section-head">
          <h2>
            Waiting for you<span className="count">{approvals.length}</span>
          </h2>
          <span className="small soft">Only you can approve. Your agents see &ldquo;waiting for the owner&rdquo;.</span>
        </div>
        {approvals.length === 0 ? (
          <p className="empty">Nothing waiting. Your agents are working inside your rules.</p>
        ) : (
          <div className="asks">
            {approvals.map((r) => (
              <article className="ask" key={r.id}>
                <div className="spread">
                  <Who actor={r.action.actor} />
                  <span className="small muted">{ago(r.createdAt)}</span>
                </div>
                <div className="stack" style={{ gap: 2 }}>
                  <span className="soft">{ACTION_LABEL[r.action.kind] ?? r.action.kind}</span>
                  {r.action.amount !== undefined && <span className="amount">{formatMoney(r.action.amount, r.action.currency ?? shop.currency)}</span>}
                </div>
                <p className="small">{r.action.reason}</p>
                <p className="small" style={{ color: 'var(--hold)' }}>{r.decision?.hits.map((h) => h.message).join(' ')}</p>
                <Decision id={r.id} />
                <a className="small" href={`/approve/${r.id}`}>
                  Full details
                </a>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="orders" className="section">
        <div className="section-head">
          <h2>
            Orders<span className="count">{orders.length}</span>
          </h2>
        </div>
        <OrdersGrid rows={orderRows} />
        {missed.length > 0 && (
          <div className="panel panel-tight stack" style={{ gap: 8 }}>
            <h3>What shoppers couldn&apos;t get</h3>
            <ul className="small soft" style={{ margin: 0, paddingLeft: 18 }}>
              {[...new Set(missed.map((m) => m.message))].slice(0, 6).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section id="catalog" className="section">
        <div className="section-head">
          <h2>Catalog</h2>
          <span className="small soft">
            Your agent can change prices and stock with <code>sayso price</code> and <code>sayso stock</code>.
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th className="num">Price</th>
                <th className="num">Stock</th>
                <th>Variant ID</th>
              </tr>
            </thead>
            <tbody>
              {catalog.products.flatMap((p) =>
                p.variants.map((v, i) => (
                  <tr key={v.id}>
                    <td>{i === 0 ? <b>{p.name}</b> : null}</td>
                    <td>{v.title}</td>
                    <td className="num mono">{money(v.price)}</td>
                    <td className="num">
                      {v.madeToOrderDays !== undefined ? (
                        <span className="soft small">made to order, {v.madeToOrderDays}d</span>
                      ) : (
                        <span className={v.inventory === 0 ? 'stock-out' : undefined}>{v.inventory}</span>
                      )}
                    </td>
                    <td className="mono small soft">{v.id}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <p className="small soft">
          Shipping: {shop.shipping.map((s) => `${s.name} to ${s.countries.join(', ')} ${money(s.price)}${s.freeAbove ? `, free over ${money(s.freeAbove)}` : ''}`).join(' · ')}
        </p>
      </section>

      <section id="rules" className="section">
        <div className="section-head">
          <h2>Your rules</h2>
          <span className="small soft">Your agent can propose new rules. They apply only after you approve them.</span>
        </div>
        <div className="panel">
          {policy.source && (
            <p className="soft small" style={{ marginBottom: 10 }}>
              You said: &ldquo;{policy.source}&rdquo;
            </p>
          )}
          <ul className="rules">
            {policy.rules.map((r) => {
              const blocks = r.type === 'never' || r.type === 'no_duplicates' || ('then' in r && r.then === 'deny');
              return (
                <li key={r.id}>
                  <span className={`rule-tag ${blocks ? 'rule-block' : 'rule-ask'}`}>{blocks ? 'Block' : 'Ask me'}</span>
                  <span>{describeRule(r, shop.currency)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section id="agents" className="section">
        <div className="section-head">
          <h2>
            Your agents<span className="count">{liveKeys.length}</span>
          </h2>
          <span className="small soft">Each key runs this shop. None can approve, publish or change rules.</span>
        </div>
        <div className="split">
          <div className="stack" style={{ gap: 16 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Key</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <Who actor={{ type: 'agent', id: `agent:${k.label}` }} />
                      </td>
                      <td className="mono small">...{k.hint}</td>
                      <td className="small soft">{k.revokedAt ? <Status value="rejected" /> : k.lastUsedAt ? ago(k.lastUsedAt) : 'never'}</td>
                      <td style={{ textAlign: 'right' }}>{!k.revokedAt && <RevokeKey id={k.id} label={k.label} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <NewKey />
          </div>
          <div className="stack" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">Terminal</span>
              <CopyField value={`node cli/sayso.ts login --url ${baseUrl} --key sk_agent_...`} />
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">MCP, for your agent</span>
              <CopyField value={`${baseUrl}/api/mcp`} />
              <span className="small soft">Send the key as Authorization: Bearer sk_agent_...</span>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <span className="eyebrow">MCP, for shoppers</span>
              <CopyField value={`${baseUrl}/api/shops/${shop.slug}/mcp`} />
            </div>
          </div>
        </div>
      </section>

      <section id="audit" className="section">
        <div className="section-head">
          <h2>
            Audit log<span className="count">{audit.length}</span>
          </h2>
          <span className="small soft row" style={{ gap: 6 }}>
            <Icon name="chain" size={16} /> Every record is hash-chained and re-checked when this page loads.
          </span>
        </div>
        <AuditGrid rows={auditRows} />
      </section>
    </main>
  );
}
