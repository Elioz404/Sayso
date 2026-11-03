// The owner's dashboard: what's waiting for their say-so, orders, catalog, rules, agent keys and the
// audit trail. Everything here is behind the owner session.
import { connection } from 'next/server';
import { LoginForm, NewKey, PublishButton, RevokeKey, SignOut, Decision } from '@/app/_components/owner-actions.tsx';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { ownerShopId } from '@/server/http.ts';

export default async function Owner() {
  await connection();
  const shopId = await ownerShopId();
  if (!shopId) {
    return (
      <main className="narrow">
        <h1>Your shop</h1>
        <LoginForm demo={process.env.SAYSO_DEMO === 'true'} />
        <p className="small muted">
          New here? <a href="/start">Draft a shop from photos</a>.
        </p>
      </main>
    );
  }

  const { shops, seller, access, baseUrl } = await ready();
  const catalog = await shops.get(shopId);
  const { shop } = catalog;
  const [orders, approvals, audit, rules, keys, missed] = await Promise.all([
    seller.orders(shopId),
    seller.approvals(shopId),
    seller.audit(shopId, 100),
    seller.describePolicy(shopId, shop.currency),
    access.listKeys(shopId),
    seller.missedDemand(shopId),
  ]);
  const status = shop.status ?? 'live';

  return (
    <main>
      <div className="spread">
        <div>
          <h1>
            {shop.name} <span className={`pill ${status}`}>{status}</span>
          </h1>
          <p className="muted small">
            <code>{shop.slug}</code> · buyer agents: <code>{`${baseUrl}/api/shops/${shop.slug}/mcp`}</code>
          </p>
        </div>
        <SignOut />
      </div>

      {status === 'draft' && (
        <div className="card warn">
          <h3>Review your catalog, then publish</h3>
          <p className="small">Publishing registers your products with PayPal and lets AI shopping agents buy them.</p>
          <PublishButton />
        </div>
      )}

      <h2>Waiting for your say-so ({approvals.length})</h2>
      {approvals.length === 0 && <p className="muted">Nothing right now. Your agents are inside your rules.</p>}
      <div className="grid">
        {approvals.map((r) => (
          <div className="card" key={r.id}>
            <div className="spread">
              <h3>
                <a href={`/approve/${r.id}`}>{r.action.kind}</a>
              </h3>
              {r.action.amount !== undefined && <b>{formatMoney(r.action.amount, r.action.currency ?? shop.currency)}</b>}
            </div>
            <p className="small">{r.action.reason}</p>
            <p className="small muted">{r.decision?.hits.map((h) => h.message).join(' ')}</p>
            <Decision id={r.id} />
          </div>
        ))}
      </div>

      <h2>Orders</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Order</th><th>Status</th><th>Total</th><th>Items</th><th>Via</th><th>Tracking</th></tr>
          </thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={6} className="muted">No orders yet.</td></tr>}
            {orders.map((o) => (
              <tr key={o.id}>
                <td>{o.number ?? <code>{o.id}</code>}<div className="small muted">{new Date(o.createdAt).toLocaleString('en-US')}</div></td>
                <td><span className={`pill ${o.status}`}>{o.status.replace('_', ' ')}</span></td>
                <td>{o.total ?? '-'}</td>
                <td>{o.items.map((i) => `${i.quantity}x ${i.name ?? i.variant_id}`).join(', ')}</td>
                <td>{o.channel ?? '-'}</td>
                <td>{o.tracking ? `${o.tracking.carrier} ${o.tracking.number}` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missed.length > 0 && (
        <>
          <h2>What buyers couldn&apos;t get</h2>
          <ul>{missed.slice(0, 10).map((m, i) => <li key={i} className="small">{m.message}</li>)}</ul>
        </>
      )}

      <h2>Catalog</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Product</th><th>Variant</th><th>Price</th><th>Stock</th><th>PayPal</th></tr>
          </thead>
          <tbody>
            {catalog.products.flatMap((p) =>
              p.variants.map((v) => (
                <tr key={v.id}>
                  <td>{p.name}</td>
                  <td>{v.title} <code className="muted small">{v.id}</code></td>
                  <td>{formatMoney(v.price, shop.currency)}</td>
                  <td>{v.madeToOrderDays !== undefined ? `made to order (${v.madeToOrderDays}d)` : v.inventory}</td>
                  <td className="small muted">{p.paypalProductId ?? '-'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Shipping: {shop.shipping.map((s) => `${s.name} to ${s.countries.join(', ')} ${formatMoney(s.price, shop.currency)}`).join(' · ')}
      </p>

      <h2>Your rules</h2>
      <div className="card">
        {rules.source && <p className="muted small">&ldquo;{rules.source}&rdquo;</p>}
        <ul>{rules.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="small muted">
          Your agent can propose new rules (<code>sayso policy propose &quot;...&quot;</code>); they apply only after you approve them here.
        </p>
      </div>

      <h2>Your agents</h2>
      <div className="card stack">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th /></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.label}</td>
                  <td><code>sk_agent_...{k.hint}</code></td>
                  <td className="small">{new Date(k.createdAt).toLocaleDateString('en-US')}</td>
                  <td className="small">{k.revokedAt ? <span className="pill rejected">revoked</span> : k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-US') : 'never'}</td>
                  <td>{!k.revokedAt && <RevokeKey id={k.id} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <NewKey />
        <details>
          <summary className="small">Connect an agent</summary>
          <pre>{`# terminal (or let your coding agent run it)
node cli/sayso.ts login --url ${baseUrl} --key sk_agent_...

# any MCP client
{ "mcpServers": { "${shop.slug}": { "url": "${baseUrl}/api/mcp",
  "headers": { "Authorization": "Bearer sk_agent_..." } } } }`}</pre>
        </details>
      </div>

      <h2>Audit log</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>When</th><th>Action</th><th>Amount</th><th>By</th><th>Status</th><th>Chain</th></tr>
          </thead>
          <tbody>
            {audit.length === 0 && <tr><td colSpan={6} className="muted">No agent actions yet.</td></tr>}
            {audit.map((r) => (
              <tr key={r.id}>
                <td className="small">{new Date(r.createdAt).toLocaleString('en-US')}<div><a href={`/approve/${r.id}`}><code>{r.id}</code></a></div></td>
                <td>{r.action.kind}</td>
                <td>{r.action.amount !== undefined ? formatMoney(r.action.amount, r.action.currency ?? shop.currency) : '-'}</td>
                <td className="small">{r.action.actor.id}</td>
                <td><span className={`pill ${r.status}`}>{r.status.replace('_', ' ')}</span></td>
                <td>{r.chainIntact ? <span className="ok small">intact</span> : <span className="error small">TAMPERED</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
