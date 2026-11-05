// The owner's say-so screen, built for a phone: this is where the push notification lands. It needs
// the owner session; an agent holding an agent key has no way in. The request shows as its receipt, the
// same one Activity opens, with the OK and Reject buttons while it waits.
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Decision, LoginForm } from '@/app/_components/owner-actions.tsx';
import { RecordReceipt } from '@/app/_components/record-receipt.tsx';
import { recordView } from '@/core/record-view.ts';
import { demoEnabled, paypalLoginEnabled } from '@/server/context.ts';
import { ownerView } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Your say-so' };

export default async function Approve({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const view = await ownerView();
  if (!view) {
    return (
      <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <h1>Sign in to decide</h1>
          <p className="soft">Only the shop owner can see and approve this request.</p>
        </div>
        <LoginForm demo={demoEnabled()} paypal={paypalLoginEnabled()} next={`/approve/${id}`} />
      </main>
    );
  }

  const onTour = Boolean(await view.tours?.forShop(view.shopId));
  const record = await view.saySo.record(view.shopId, id).catch(() => undefined);
  if (!record) notFound();

  const [passkey, signed] = await Promise.all([view.passkeys.required(view.shopId), view.passkeys.checkApproval(record)]);
  const receipt = recordView(record, view.redact, signed);

  return (
    <main className="wrap wrap-narrow page" style={{ paddingTop: 'var(--s6)' }}>
      <div className="receipt-page">
        <RecordReceipt record={receipt}>{receipt.status === 'pending_approval' && <Decision id={record.id} big passkey={passkey} />}</RecordReceipt>
      </div>
      <p className="small soft" style={{ marginTop: 18 }}>
        <a href="/owner#waiting">Everything waiting for you</a> · <a href="/owner/activity">Activity</a>
        {onTour && (
          <>
            {' '}
            · <a href="/tour#sell">Back to For Judges</a>
          </>
        )}
      </p>
    </main>
  );
}
