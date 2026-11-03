// Public shop page: what people see, and where AI shopping agents are pointed.
import { connection } from 'next/server';
import { isLive } from '@/core/catalog.ts';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const { catalogs, baseUrl } = await ready();
  const catalog = await catalogs.bySlug(slug);
  if (!catalog || !isLive(catalog)) {
    return (
      <main className="narrow">
        <h1>Shop not found</h1>
        <p className="muted">It may not be published yet.</p>
      </main>
    );
  }
  const { shop } = catalog;
  const mcp = `${baseUrl}/api/shops/${shop.slug}/mcp`;

  return (
    <main>
      <h1>{shop.name}</h1>
      <p className="muted">
        Ships from {shop.country} · {shop.returnPolicy.days}-day returns · pay with PayPal
      </p>

      <div className="card">
        <h3>Shop here with your AI assistant</h3>
        <p className="small muted">Add this MCP server to your assistant and ask it to buy something. You approve the payment in PayPal.</p>
        <pre>{mcp}</pre>
        <p className="small muted">
          Agents on PayPal&apos;s commerce platform use the merchant-cart API at <code>{`${baseUrl}/api/shops/${shop.slug}/merchant-cart`}</code>.
        </p>
      </div>

      <div className="grid">
        {catalog.products.map((p) => (
          <div className="card" key={p.id}>
            <h3>{p.name}</h3>
            <p className="small muted">{p.description}</p>
            <ul className="small">
              {p.variants.map((v) => (
                <li key={v.id}>
                  {v.title}: <b>{formatMoney(v.price, shop.currency)}</b>{' '}
                  <span className="muted">
                    {v.madeToOrderDays !== undefined ? `made to order, ~${v.madeToOrderDays} days` : v.inventory > 0 ? `${v.inventory} in stock` : 'sold out'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="small muted">
        Shipping: {shop.shipping.map((s) => `${s.name} (${s.countries.join(', ')}) ${formatMoney(s.price, shop.currency)}${s.freeAbove ? `, free over ${formatMoney(s.freeAbove, shop.currency)}` : ''}`).join(' · ')}
      </p>
    </main>
  );
}
