// Public shop page: what people see, and where AI shopping assistants are pointed.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { isLive } from '@/core/catalog.ts';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const catalog = await (await ready()).catalogs.bySlug((await params).slug).catch(() => undefined);
  return { title: catalog?.shop.name ?? 'Shop' };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const { catalogs, baseUrl } = await ready();
  const catalog = await catalogs.bySlug(slug);
  if (!catalog || !isLive(catalog)) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>Shop not found</h1>
        <p className="soft">It may not be published yet.</p>
      </main>
    );
  }
  const { shop } = catalog;
  const money = (minor: number) => formatMoney(minor, shop.currency);

  return (
    <main className="wrap page stack" style={{ gap: 'var(--s6)' }}>
      <div className="split" style={{ alignItems: 'end' }}>
        <div className="stack" style={{ gap: 10 }}>
          <h1 className="display" style={{ fontSize: 'var(--t-display)', lineHeight: 1.05 }}>{shop.name}</h1>
          <p className="soft">
            Ships from {shop.country} · {shop.returnPolicy.days}-day returns{shop.returnPolicy.buyerPaysReturn ? '' : ', free'} · Pay with PayPal
          </p>
        </div>
        <div className="panel panel-raised stack" style={{ gap: 10 }}>
          <span className="row" style={{ gap: 8 }}>
            <Icon name="bag" size={18} />
            <b>Shop here with your AI assistant</b>
          </span>
          <p className="small soft">Add this to any MCP client and ask for what you want. You approve the payment in PayPal.</p>
          <CopyField value={`${baseUrl}/api/shops/${shop.slug}/mcp`} />
        </div>
      </div>

      <div className="products">
        {catalog.products.map((p) => (
          <article className="product" key={p.id}>
            <div className="stack" style={{ gap: 4 }}>
              <h2 style={{ fontSize: 'var(--t-md)' }}>{p.name}</h2>
              <p className="small soft">{p.description}</p>
            </div>
            <ul className="variants">
              {p.variants.map((v) => (
                <li key={v.id}>
                  <span className="stack" style={{ gap: 0 }}>
                    <span>{v.title}</span>
                    <span className={`small ${v.madeToOrderDays === undefined && v.inventory === 0 ? 'stock-out' : 'muted'}`}>
                      {v.madeToOrderDays !== undefined ? `Made to order, about ${v.madeToOrderDays} days` : v.inventory > 0 ? `${v.inventory} in stock` : 'Sold out'}
                    </span>
                  </span>
                  <span className="price">{money(v.price)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Shipping</th>
              <th>To</th>
              <th>Arrives in</th>
              <th className="num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {shop.shipping.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="small soft">{s.countries.join(', ')}</td>
                <td className="small soft">
                  {s.minDays}-{s.maxDays} days
                </td>
                <td className="num mono">
                  {money(s.price)}
                  {s.freeAbove ? <span className="small soft"> · free over {money(s.freeAbove)}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="small soft">
        Assistants on PayPal&apos;s commerce platform use the merchant-cart API at <span className="mono">{`${baseUrl}/api/shops/${shop.slug}/merchant-cart`}</span>.
      </p>
    </main>
  );
}
