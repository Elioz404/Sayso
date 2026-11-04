// The owner's catalog, in two tabs: Products (edited in place, ten to a page) and Shipping.
import type { Metadata } from 'next';
import { ProductCard, ShippingEditor, type EditableProduct } from '@/app/_components/catalog-editor.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { soldSince } from '@/core/catalog-view.ts';
import { toMoney } from '@/core/money.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Catalog' };

const PER_PAGE = 10;

export default async function Catalog({ searchParams }: { searchParams: Promise<{ added?: string; tab?: string; page?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { catalog, shop, demo } = view;
  const { added, tab, page: pageParam } = await searchParams;
  const shipping = tab === 'shipping';
  const plain = (minor: number) => toMoney(minor, shop.currency).value;

  const pages = Math.max(1, Math.ceil(catalog.products.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(pageParam)) || 1));
  // What sold in the last two weeks, next to each option: what to restock, what to reprice.
  const sold = shipping ? new Map<string, number>() : soldSince(await view.orders.list(view.shopId), new Date(Date.now() - 14 * 86_400_000));
  const products: EditableProduct[] = catalog.products.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    ...(p.imageUrl ? { image: p.imageUrl } : {}),
    variants: p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      price: plain(v.price),
      stock: v.madeToOrderDays === undefined ? v.inventory : null,
      ...(v.madeToOrderDays !== undefined ? { madeDays: v.madeToOrderDays } : {}),
      sold: sold.get(v.id) ?? 0,
      toConfirm: Boolean(v.priceToConfirm),
    })),
  }));

  return (
    <>
      <div className="view-head">
        <div>
          <h1>Catalog</h1>
          <p className="sub">
            {catalog.products.length} product{catalog.products.length === 1 ? '' : 's'}. Edit any of them here, or ask your connected agent to change names, prices and
            stock.
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

      <nav className="tabs" aria-label="Catalog">
        <a href="/owner/catalog" aria-current={shipping ? undefined : 'page'}>
          Products <span className="tabs-count">{catalog.products.length}</span>
        </a>
        <a href="/owner/catalog?tab=shipping" aria-current={shipping ? 'page' : undefined}>
          Shipping <span className="tabs-count">{shop.shipping.length}</span>
        </a>
      </nav>

      {shipping ? (
        <section className="block" aria-label="Shipping">
          <ShippingEditor
            currency={shop.currency}
            readOnly={demo}
            rules={shop.shipping.map((s) => ({
              id: s.id,
              name: s.name,
              where: s.countries.includes('*') ? 'worldwide' : s.countries.join(', '),
              days: `${s.minDays}-${s.maxDays} days`,
              price: plain(s.price),
              freeAbove: s.freeAbove ? plain(s.freeAbove) : '',
            }))}
          />
          {demo && <p className="small soft">The shared demo shop&apos;s shipping stays as it is.</p>}
        </section>
      ) : (
        <section className="block" aria-label="Products">
          {demo && <p className="small soft">The shared demo shop&apos;s catalog stays as it is. Open your own shop from For Judges to edit yours.</p>}
          <ul className="sell-cards">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} currency={shop.currency} readOnly={demo} />
            ))}
          </ul>
          {pages > 1 && (
            <nav className="pager" aria-label="Pages">
              {page > 1 && (
                <a href={`/owner/catalog?page=${page - 1}`} aria-label="Previous page">
                  ‹
                </a>
              )}
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <a key={n} href={`/owner/catalog?page=${n}`} aria-current={n === page ? 'page' : undefined}>
                  {n}
                </a>
              ))}
              {page < pages && (
                <a href={`/owner/catalog?page=${page + 1}`} aria-label="Next page">
                  ›
                </a>
              )}
            </nav>
          )}
        </section>
      )}
    </>
  );
}
