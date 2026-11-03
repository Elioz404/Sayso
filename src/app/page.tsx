// Skeleton owner view: the shop, agent-made carts and the Guard queue. Replaced on day 6 by the
// AG Studio dashboard; kept simple so the end-to-end flow can be exercised from day 1.
import { connection } from 'next/server';
import { formatMoney } from '@/core/money.ts';
import { ctx } from '@/server/context.ts';
import { GuardActions } from './guard-actions.tsx';

export default async function Home() {
  await connection();
  const { catalogs, carts, guardStore } = ctx();
  const catalog = await catalogs.bySlug('maya-ceramics');
  const records = await guardStore.listSince('shop_maya', new Date(0));
  if (!catalog) return <p>Demo shop missing.</p>;
  const { shop } = catalog;

  return (
    <>
      <h1>{shop.name}</h1>
      <p className="muted">
        Agent endpoint: <code>/api/shops/{shop.slug}/merchant-cart</code> (PayPal Agentic Commerce merchant-cart v1)
      </p>

      <h2>Say-so queue and audit</h2>
      <table>
        <thead>
          <tr><th>Record</th><th>Action</th><th>Amount</th><th>Status</th><th>Why</th><th /></tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr><td colSpan={6} className="muted">No agent actions yet.</td></tr>
          )}
          {records.map((r) => (
            <tr key={r.id}>
              <td><code>{r.id}</code></td>
              <td>{r.action.kind}<br /><span className="muted">{r.action.actor.id}</span></td>
              <td>{r.action.amount !== undefined ? formatMoney(r.action.amount, r.action.currency ?? 'USD') : '-'}</td>
              <td className={`status ${r.status}`}>{r.status.replace('_', ' ')}</td>
              <td>
                {r.decision?.hits.map((h) => <div key={h.ruleId}>{h.message}</div>)}
                {r.simulation?.effects.map((e) => <div key={e} className="muted">{e}</div>)}
              </td>
              <td>{r.status === 'pending_approval' && <GuardActions id={r.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Carts from agents</h2>
      <table>
        <thead>
          <tr><th>Cart</th><th>Channel</th><th>Status</th><th>Total</th><th>Issues</th></tr>
        </thead>
        <tbody>
          {carts.all().map((c) => (
            <tr key={c.id}>
              <td><code>{c.id}</code></td>
              <td>{c.channel ?? '-'}</td>
              <td>{c.cart.status}</td>
              <td>{c.cart.totals?.total.value} {c.cart.totals?.total.currency_code}</td>
              <td>{c.cart.validation_issues?.map((i) => <div key={i.message}>{i.code}: {i.user_message ?? i.message}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Catalog</h2>
      <table>
        <thead>
          <tr><th>Product</th><th>Variant</th><th>Price</th><th>Stock</th></tr>
        </thead>
        <tbody>
          {catalog.products.flatMap((p) =>
            p.variants.map((v) => (
              <tr key={v.id}>
                <td>{p.name}</td>
                <td>{v.title} <code className="muted">{v.id}</code></td>
                <td>{formatMoney(v.price, shop.currency)}</td>
                <td>{v.madeToOrderDays !== undefined ? `made to order (${v.madeToOrderDays}d)` : v.inventory}</td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </>
  );
}
