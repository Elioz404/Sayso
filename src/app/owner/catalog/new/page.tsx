// New products from the camera: snap or share photos, Sayso drafts each product with a market price
// suggestion, and it goes on sale once the owner sets the price.
import type { Metadata } from 'next';
import { PhotoDrafter, type DraftView } from '@/app/_components/photo-drafter.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { formatMoney, toMoney } from '@/core/money.ts';
import { MAX_DRAFT_PHOTOS } from '@/core/limits.ts';
import { SHARED_DEMO_READ_ONLY } from '@/server/http.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Add from a photo' };

export default async function NewFromPhoto({ searchParams }: { searchParams: Promise<{ shared?: string }> }) {
  const view = await ownerView();
  if (!view) return null;
  const { catalog, demo, shop } = view;
  const money = (minor: number) => formatMoney(minor, shop.currency);
  const plain = (minor: number) => toMoney(minor, shop.currency).value;
  const shared = Math.max(0, Math.min(MAX_DRAFT_PHOTOS, Number((await searchParams).shared) || 0));

  const drafts: DraftView[] = (catalog.drafts ?? []).map((d) => {
    const s = d.variants.find((v) => v.priceToConfirm?.suggested)?.priceToConfirm?.suggested;
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      image: d.imageUrl,
      ...(s ? { suggested: `Similar items sell for ${money(s.low)} to ${money(s.high)} (${s.listings} listings).` } : {}),
      variants: d.variants.map((v) => ({ id: v.id, title: v.title, price: v.price > 0 ? plain(v.price) : '', inventory: v.inventory, madeToOrder: v.madeToOrderDays !== undefined })),
    };
  });

  return (
    <>
      <div className="stack" style={{ gap: 'var(--s3)' }}>
        <a href="/owner/catalog" className="small row" style={{ gap: 4 }}>
          <Icon name="back" size={14} /> Catalog
        </a>
        <div className="view-head">
          <div>
            <h1>Add from a photo</h1>
            <p className="sub">Photos in, listings out. Sayso writes them; you check them and set the price.</p>
          </div>
        </div>
      </div>
      {demo ? (
        <div className="empty">
          <b>Not in the shared demo shop.</b>
          <span className="small">{SHARED_DEMO_READ_ONLY}</span>
        </div>
      ) : (
        <PhotoDrafter drafts={drafts} sharedCount={shared} currency={shop.currency} />
      )}
    </>
  );
}
