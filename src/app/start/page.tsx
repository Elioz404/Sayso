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
  const resume = draft && !isLive(draft) ? { shop: { slug: draft.shop.slug, name: draft.shop.name }, draft: draftView(draft) } : undefined;
  const judge = (await searchParams).judge === '1' || (draftId ? (await tours?.forShop(draftId))?.kind === 'seller' : false);
  return (
    <main className="wrap page">
      <OnboardFlow paypalLogin={paypalLoginEnabled()} judge={judge} resume={resume} />
    </main>
  );
}
