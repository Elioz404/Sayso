import type { Metadata } from 'next';
import { connection } from 'next/server';
import { OnboardFlow } from '@/app/_components/onboard-form.tsx';
import { isLive } from '@/core/catalog.ts';
import { draftView } from '@/core/catalog-view.ts';
import { paypalLoginEnabled, ready } from '@/server/context.ts';
import { claimedShop } from '@/server/seller-session.ts';

export const metadata: Metadata = { title: 'Open your shop' };

export default async function Start({ searchParams }: { searchParams: Promise<{ judge?: string }> }) {
  await connection();
  const { catalogs, tours } = await ready();
  // A draft this browser made in the last hour and hasn't published: pick it up at the review.
  const draftId = await claimedShop();
  const draft = draftId ? await catalogs.byShopId(draftId) : undefined;
  // Only that draft carries For Judges with it; a new shop is a judge's only when For Judges sent them here.
  const resume =
    draft && !isLive(draft)
      ? { shop: { slug: draft.shop.slug, name: draft.shop.name }, draft: draftView(draft), judge: (await tours?.forShop(draft.shop.id))?.kind === 'seller' }
      : undefined;
  return (
    <main className="wrap page">
      <OnboardFlow paypalLogin={paypalLoginEnabled()} judge={(await searchParams).judge === '1'} resume={resume} />
    </main>
  );
}
