// New products from the camera: snap or share photos, Sayso drafts each product with a market price
// suggestion, and it goes on sale once the owner sets the price.
import type { Metadata } from 'next';
import { PhotoDrafter, type DraftView } from '@/app/_components/phone.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { formatMoney, toMoney } from '@/core/money.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Add from a photo' };

export default async function NewFromPhoto({ searchParams }: { searchParams: Promise<{ shared?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { catalog, demo, shop } = view;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const plain = (minor: number) => toMoney(minor, shop.currency).value;
  const shared = Math.max(0, Math.min(6, Number((await searchParams).shared) || 0));

  const drafts: DraftView[] = (catalog.drafts ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    image: d.imageUrl,
    variants: d.variants.map((v) => {
      const s = v.priceToConfirm?.suggested;
      return {
        id: v.id,
        title: v.title,
        price: v.price > 0 ? plain(v.price) : '',
        suggested: s ? `Similar items sell for ${money(s.low)} to ${money(s.high)} (${s.listings} listings)` : undefined,
        inventory: v.inventory,
        madeToOrder: v.madeToOrderDays !== undefined,
      };
    }),
  }));

  return (
    <>
      <div className="stack" style={{ gap: 'var(--s3)' }}>
        <a href="/owner/catalog" className="small row" style={{ gap: 4 }}>
          <Icon name="back" size={14} /> Catalog
        </a>
        <div className="view-head">
          <div>
            <h1>Add from a photo</h1>
            <p className="sub">Point your phone at it. Sayso writes the listing; you set the price.</p>
          </div>
        </div>
      </div>
      <PhotoDrafter drafts={drafts} shared={demo} sharedCount={shared} />
    </>
  );
}
