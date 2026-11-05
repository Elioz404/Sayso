// One product: its photo, its variants with price and stock, and the exact thing to ask an assistant
// for. Its own URL and schema.org Product markup, so agents and search can point at it directly.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { ShopPhoto } from '@/app/_components/photo.tsx';
import { type Catalog, isLive, variantTitle } from '@/core/catalog.ts';
import { jsonLdScript, productJsonLd } from '@/core/discovery.ts';
import { formatMoney } from '@/core/money.ts';
import { AddToCart } from '@/app/_components/cart-actions.tsx';
import { assistantLink, assistantPrompt, cartLine, stockNote } from '@/core/storefront.ts';
import { ready } from '@/server/context.ts';
import { shopBySlug } from '@/server/shops.ts';

async function find(slug: string, productId: string): Promise<{ catalog: Catalog; index: number } | undefined> {
  const catalog = await shopBySlug(slug);
  if (!catalog || !isLive(catalog)) return undefined;
  const index = catalog.products.findIndex((p) => p.id === productId);
  return index === -1 ? undefined : { catalog, index };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string; product: string }> }): Promise<Metadata> {
  const { slug, product } = await params;
  const found = await find(slug, product);
  if (!found) return { title: 'Product' };
  const p = found.catalog.products[found.index];
  const title = `${p.name} · ${found.catalog.shop.name}`;
  return {
    title: { absolute: `${title} · Sayso` },
    description: p.description,
    openGraph: { title, description: p.description, images: p.imageUrl ? [p.imageUrl] : undefined },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; product: string }> }) {
  await connection();
  const { slug, product: productId } = await params;
  const found = await find(slug, productId);
  const { links } = await ready();
  if (!found) notFound();
  const { catalog, index } = found;
  const { shop } = catalog;
  const product = catalog.products[index];
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const home = shop.shipping.filter((s) => s.countries.includes(shop.country)).sort((a, b) => a.price - b.price)[0];
  const others = catalog.products.filter((p) => p.id !== product.id).slice(0, 3);
  const prices = product.variants.map((v) => v.price);
  const from = Math.min(...prices);

  return (
    <main className="storefront">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(catalog, product, links)) }} />

      <nav className="wrap crumbs small" aria-label="Breadcrumb">
        <a href={links.shopPage(shop.slug)}>{shop.name}</a>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{product.name}</span>
      </nav>

      <section className="wrap item">
        <figure className="item-photo">
          {product.imageUrl ? (
            <ShopPhoto url={product.imageUrl} alt={product.name} sizes="(max-width: 860px) 100vw, 50vw" priority />
          ) : (
            <span className="item-photo-empty small muted">No photo yet</span>
          )}
        </figure>

        <div className="stack item-info">
          <div className="stack" style={{ gap: 'var(--s2)' }}>
            <h1 className="display item-name">{product.name}</h1>
            <p className="item-price">{prices.every((p) => p === from) ? money(from) : `From ${money(from)}`}</p>
            <p className="soft">{product.description}</p>
          </div>

          <ul className="good-variants">
            {product.variants.map((v) => {
              const note = stockNote(v);
              return (
                <li key={v.id} className={note.tone === 'out' ? 'is-out' : undefined}>
                  <span className="stack" style={{ gap: 0 }}>
                    <span>{variantTitle(v.title) || product.name}</span>
                    <span className={`stock stock-${note.tone}`}>{note.text}</span>
                  </span>
                  <span className="good-buy-row">
                    <span className="good-price">{money(v.price)}</span>
                    {note.tone !== 'out' && <AddToCart shop={{ slug: shop.slug, name: shop.name }} line={cartLine(catalog, product, v, links)} />}
                  </span>
                </li>
              );
            })}
          </ul>

          <a className="btn good-buy" href={assistantLink(assistantPrompt(catalog, product))}>
            Buy with AI
          </a>

          <details className="buy-via-own">
            <summary>Or ask your own assistant (ChatGPT, any MCP client)</summary>
            <ol className="buy-via-steps">
              <li>
                <span>Add Sayso as a connector in ChatGPT or any MCP client.</span>
                <CopyField value={links.shoppingMcp} />
              </li>
              <li>
                <span>Then ask:</span>
                <CopyField value={assistantPrompt(catalog, product)} />
              </li>
              <li>
                <span>Approve the exact total in PayPal. {shop.name} prices it, never the assistant.</span>
              </li>
            </ol>
          </details>

          <p className="small soft">
            {home ? `${home.name}: ${money(home.price)}${home.freeAbove ? `, free over ${money(home.freeAbove)}` : ''}, ${home.minDays}-${home.maxDays} days. ` : ''}
            {shop.returnPolicy.days}-day returns{shop.returnPolicy.buyerPaysReturn ? '' : ', return shipping on the shop'}.
          </p>
        </div>
      </section>

      {others.length > 0 && (
        <section className="wrap stack" style={{ gap: 'var(--s5)' }} aria-labelledby="more">
          <h2 id="more">More from {shop.name}</h2>
          <div className="goods goods-small">
            {others.map((p) => (
              <a className="good good-tile" key={p.id} href={links.productPage(shop.slug, p.id)}>
                {p.imageUrl && (
                  <div className="good-photo">
                    <ShopPhoto url={p.imageUrl} alt="" sizes="(max-width: 640px) 100vw, 33vw" />
                  </div>
                )}
                <div className="good-body">
                  <b>{p.name}</b>
                  <span className="small soft">From {money(Math.min(...p.variants.map((v) => v.price)))}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {shop.demo && (
        <p className="wrap small muted">
          {shop.name} is a demo shop on the PayPal sandbox: the maker, the work and the photos (AI-generated) are made up, and no real money moves.
        </p>
      )}
    </main>
  );
}
