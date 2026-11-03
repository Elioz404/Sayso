// Public shop page: what people see, and where AI shopping assistants are pointed. The shop's job is to
// sell, and here selling happens through the visitor's own assistant: the page leads with the shop and
// its work, and the one action is handing the assistant this shop.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { PhotoCredits, ShopPhoto } from '@/app/_components/photo.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { available, isLive, type Catalog, type Variant } from '@/core/catalog.ts';
import { jsonLdScript, shopJsonLd } from '@/core/discovery.ts';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const catalog = await (await ready()).catalogs.bySlug((await params).slug).catch(() => undefined);
  return { title: catalog?.shop.name ?? 'Shop' };
}

/** What to say to an assistant, built from something this shop can actually sell right now. */
function examplePrompt({ shop, products }: Catalog): string {
  const pick = products.flatMap((p) => p.variants.map((v) => ({ p, v }))).find(({ v }) => v.madeToOrderDays === undefined && v.inventory > 1);
  const item = pick ? `a ${pick.v.title} ${pick.p.name}` : `something from ${shop.name}`;
  return pick ? `Buy ${item} from ${shop.name} on Sayso and ship it to me.` : `Show me what ${shop.name} sells on Sayso.`;
}

function stockNote(v: Variant): { text: string; tone: 'ok' | 'low' | 'out' | 'made' } {
  if (v.madeToOrderDays !== undefined) return { text: `Made to order, about ${v.madeToOrderDays} days`, tone: 'made' };
  if (available(v) === 0) return { text: 'Sold out', tone: 'out' };
  if (v.inventory === 1) return { text: 'Last one', tone: 'low' };
  return { text: `${v.inventory} in stock`, tone: 'ok' };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const { catalogs, links } = await ready();
  const catalog = await catalogs.bySlug(slug);
  if (!catalog || !isLive(catalog)) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>Shop not found</h1>
        <p className="soft">It may not be published yet.</p>
      </main>
    );
  }
  const { shop, products } = catalog;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const freeOver = shop.shipping.find((s) => s.freeAbove && s.countries.includes(shop.country))?.freeAbove;
  const credits = [
    ...(shop.cover?.credit ? [{ what: 'The studio', credit: shop.cover.credit }] : []),
    ...products.flatMap((p) => (p.imageCredit ? [{ what: p.name, credit: p.imageCredit }] : [])),
  ];

  return (
    <main className="storefront">
      {/* What search engines and shopping crawlers read: the store, its offers, shipping and returns. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(shopJsonLd(catalog, links)) }} />

      <section className={`wrap shop-intro ${shop.cover ? '' : 'shop-intro-plain'}`}>
        <div className="stack shop-intro-text">
          <h1 className="display shop-name">{shop.name}</h1>
          <p className="shop-facts">
            {[
              `Ships from ${shop.country}`,
              freeOver !== undefined ? `Free shipping over ${money(freeOver)}` : undefined,
              `${shop.returnPolicy.days}-day returns${shop.returnPolicy.buyerPaysReturn ? '' : ', on us'}`,
              'Paid with PayPal',
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </p>

          <div className="buy-via">
            <h2 className="buy-via-title">Buy through your AI assistant</h2>
            <ol className="buy-via-steps">
              <li>
                <span>Add Sayso as a connector in ChatGPT or any MCP client.</span>
                <CopyField value={links.shoppingMcp} />
              </li>
              <li>
                <span>Ask for what you want, in your own words.</span>
                <CopyField value={examplePrompt(catalog)} />
              </li>
              <li>
                <span>Approve the exact total in PayPal. The shop prices it, never the assistant.</span>
              </li>
            </ol>
          </div>
        </div>

        {shop.cover && (
          <figure className="shop-cover">
            <ShopPhoto url={shop.cover.url} alt={shop.cover.alt} sizes="(max-width: 860px) 100vw, 46vw" priority />
          </figure>
        )}
      </section>

      <section className="wrap stack" style={{ gap: 'var(--s5)' }} aria-labelledby="work">
        <h2 id="work">In the studio now</h2>
        <div className="goods">
          {products.map((p) => (
            <article className="good" key={p.id}>
              {p.imageUrl && (
                <div className="good-photo">
                  <ShopPhoto url={p.imageUrl} alt={p.name} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw" />
                </div>
              )}
              <div className="good-body">
                <div className="stack" style={{ gap: 4 }}>
                  <h3>{p.name}</h3>
                  <p className="small soft">{p.description}</p>
                </div>
                <ul className="good-variants">
                  {p.variants.map((v) => {
                    const note = stockNote(v);
                    return (
                      <li key={v.id} className={note.tone === 'out' ? 'is-out' : undefined}>
                        <span className="stack" style={{ gap: 0 }}>
                          <span>{v.title && v.title !== 'Default' ? v.title : p.name}</span>
                          <span className={`stock stock-${note.tone}`}>{note.text}</span>
                        </span>
                        <span className="good-price">{money(v.price)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap shop-terms" aria-labelledby="delivery">
        <div className="stack" style={{ gap: 'var(--s3)' }}>
          <h2 id="delivery">Delivery</h2>
          <ul className="delivery">
            {shop.shipping.map((s) => (
              <li key={s.id}>
                <span className="stack" style={{ gap: 0 }}>
                  <b>{s.name}</b>
                  <span className="small soft">
                    {s.countries.includes('*') ? 'Worldwide' : s.countries.join(', ')} · {s.minDays}-{s.maxDays} days
                  </span>
                </span>
                <span className="good-price">
                  {money(s.price)}
                  {s.freeAbove ? <span className="small soft"> · free over {money(s.freeAbove)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="stack" style={{ gap: 'var(--s3)' }}>
          <h2>Returns</h2>
          <p className="soft">
            Send it back within {shop.returnPolicy.days} days of delivery{shop.returnPolicy.buyerPaysReturn ? '; return shipping is yours to pay' : ' and the shop covers return shipping'}.
            Your assistant can ask for the refund for you; the shop&apos;s owner decides, and PayPal returns the money.
          </p>
          <p className="small muted">
            <Icon name="terminal" size={14} /> For developers: PayPal&apos;s merchant-cart API at <span className="mono">{links.merchantCart(shop.slug)}</span>, and this
            shop alone over MCP at <span className="mono">{links.shopMcp(shop.slug)}</span>.
          </p>
        </div>
      </section>

      <div className="wrap">
        <PhotoCredits credits={credits} />
      </div>
    </main>
  );
}
