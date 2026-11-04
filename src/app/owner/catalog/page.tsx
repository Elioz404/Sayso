import type { Metadata } from 'next';
import { CatalogGrid } from '@/app/_components/grids.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { variantRows } from '@/core/catalog-view.ts';
import { formatMoney } from '@/core/money.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Catalog' };

export default async function Catalog({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { catalog, shop } = view;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const variants = catalog.products.reduce((n, p) => n + p.variants.length, 0);
  const { added } = await searchParams;

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Catalog</h1>
          <p className="sub">
            {catalog.products.length} products, {variants} variants. Change prices and stock here, or let your agent do it with <code>sayso price</code> and <code>sayso stock</code>.
          </p>
        </div>
        <a className="btn btn-primary" href="/owner/catalog/new">
          <Icon name="camera" size={18} /> Add from a photo
          {catalog.drafts?.length ? <span className="count-badge">{catalog.drafts.length}</span> : null}
        </a>
      </div>

      {added && (
        <div className="callout callout-ok" role="status">
          <span className="small">
            <b>{added.slice(0, 120)} is on sale.</b> AI shoppers can find it and buy it now.
          </span>
        </div>
      )}

      <section className="block" aria-labelledby="products">
        <h2 id="products" className="sr-only">
          Products
        </h2>
        <CatalogGrid rows={variantRows(catalog)} market={Boolean(view.market)} readOnly={view.demo} />
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
