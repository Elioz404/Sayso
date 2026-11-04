// Every shop on Sayso: the small sellers AI assistants can buy from. Pick one to see its work, or ask
// the shopping assistant, which searches all of them.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ShopPhoto } from '@/app/_components/photo.tsx';
import { formatMoney } from '@/core/money.ts';
import { shopCard } from '@/core/storefront.ts';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Shops' };

export default async function ShopsPage() {
  await connection();
  const { catalogs } = await ready();
  // The demo shop first: it is the one the docs and the tour talk about.
  const shops = (await catalogs.listLive()).map(shopCard).sort((a, b) => Number(b.demo) - Number(a.demo) || a.name.localeCompare(b.name));
  return (
    <main className="wrap page stack" style={{ gap: 'var(--s6)' }}>
      <header className="shops-head">
        <div className="stack" style={{ gap: 'var(--s2)', minWidth: 0 }}>
          <h1>Shops</h1>
          <p className="soft">Small makers who sell to AI assistants and get paid with PayPal. Open a shop to see its work, or just ask the assistant: it searches all of them.</p>
        </div>
        <a className="btn btn-primary" href="/assistant">
          Shop with AI
        </a>
      </header>
      {shops.length === 0 ? (
        <div className="empty">
          <b>No shops are open yet.</b>
          <span className="small">
            <a href="/start">Open yours</a> from a few photos.
          </span>
        </div>
      ) : (
        <ul className="shops">
          {shops.map((s) => (
            <li key={s.slug}>
              <a className="shop-card" href={`/shop/${s.slug}`}>
                <span className="shop-card-photo">{s.picture && <ShopPhoto url={s.picture} alt="" sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw" />}</span>
                <span className="shop-card-body">
                  <span className="row" style={{ gap: 'var(--s2)' }}>
                    <b className="shop-card-name">{s.name}</b>
                    {s.demo && <span className="pill-demo">Demo</span>}
                  </span>
                  <span className="small soft">
                    {[s.kinds.join(' · '), `Ships from ${s.country}`].filter(Boolean).join('  ·  ')}
                  </span>
                  <span className="small">
                    {s.products} piece{s.products === 1 ? '' : 's'}
                    {s.from !== undefined && s.to !== undefined
                      ? `, ${formatMoney(s.from, s.currency)}${s.to > s.from ? ` to ${formatMoney(s.to, s.currency)}` : ''}`
                      : ''}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">
        Sell here too: <a href="/start">open a shop from a few photos</a>. Every shop is also on Sayso&apos;s MCP server, so any assistant can buy from it.
      </p>
    </main>
  );
}
