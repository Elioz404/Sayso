import type { Metadata } from 'next';
import { formatMoney } from '@/core/money.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Catalog' };

export default async function Catalog() {
  const view = await ownerView();
  if (!view) return null;
  const { catalog, shop } = view;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const variants = catalog.products.reduce((n, p) => n + p.variants.length, 0);

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Catalog</h1>
          <p className="sub">
            {catalog.products.length} products, {variants} variants. Your agent updates prices and stock with <code>sayso price</code> and <code>sayso stock</code>.
          </p>
        </div>
      </div>

      <section className="block" aria-labelledby="products">
        <h2 id="products" className="sr-only">
          Products
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Price</th>
                <th className="num">In stock</th>
              </tr>
            </thead>
            <tbody>
              {catalog.products.flatMap((p) =>
                p.variants.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <span className="stack" style={{ gap: 2 }}>
                        <b>
                          {p.name}
                          {p.variants.length > 1 || v.title !== 'Default' ? <span className="soft" style={{ fontWeight: 400 }}> · {v.title}</span> : null}
                        </b>
                        <span className="mono muted">{v.id}</span>
                      </span>
                    </td>
                    <td className="num">{money(v.price)}</td>
                    <td className="num">
                      {v.madeToOrderDays !== undefined ? (
                        <span className="soft">Made to order, {v.madeToOrderDays} days</span>
                      ) : v.inventory === 0 ? (
                        <span className="status status-stop">Sold out</span>
                      ) : v.inventory === 1 ? (
                        <span className="status status-hold">1 left</span>
                      ) : (
                        v.inventory
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="block" aria-labelledby="shipping">
        <h2 id="shipping">Shipping</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Ships to</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {shop.shipping.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="stack" style={{ gap: 2 }}>
                      <b>{s.name}</b>
                      <span className="small muted">
                        {s.minDays}-{s.maxDays} days
                      </span>
                    </span>
                  </td>
                  <td className="soft">{s.countries.join(', ')}</td>
                  <td className="num">
                    <span className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                      {money(s.price)}
                      {s.freeAbove ? <span className="small muted">free over {money(s.freeAbove)}</span> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
