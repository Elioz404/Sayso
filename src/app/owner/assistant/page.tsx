// The owner's assistant: questions about their own shop, answered from its orders, sales and rules. Only
// the owner's session reaches it (this layout signs everyone else in first); buyers never see it.
import type { Metadata } from 'next';
import { OwnerAssistant } from '@/app/_components/owner-assistant.tsx';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Assistant' };

export default async function Assistant() {
  const view = await ownerView();
  if (!view) return null;
  return (
    <>
      <div className="view-head">
        <div>
          <h1>Assistant</h1>
          <p className="sub">
            Questions about {view.shop.name}: sales, refunds, orders, what to make, your rules. It reads; it can&apos;t change anything.
            {view.demo ? " Buyers' details are masked in the shared demo." : ''}
          </p>
        </div>
      </div>
      {/* A shop (or session kind) of its own: switching remounts it, so nothing carries over. */}
      <OwnerAssistant key={`${view.shopId}:${view.demo ? 'demo' : 'owner'}`} chat={`${view.shopId}:${view.demo ? 'demo' : 'owner'}`} />
    </>
  );
}
