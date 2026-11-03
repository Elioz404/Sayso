// The owner's say-so screen, built for a phone: this is where the push notification lands. It needs
// the owner session; an agent holding an agent key has no way in.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Decision, LoginForm } from '@/app/_components/owner-actions.tsx';
import { ACTION_LABEL, Status, Who } from '@/app/_components/ui.tsx';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { ownerShopId } from '@/server/http.ts';

export const metadata: Metadata = { title: 'Your say-so' };

export default async function Approve({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const shopId = await ownerShopId();
  if (!shopId) {
    return (
      <main className="wrap wrap-narrow stack-lg">
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Something needs your OK</span>
          <h1>Sign in to decide</h1>
          <p className="soft">Only the shop owner can see and approve this request.</p>
        </div>
        <LoginForm demo={process.env.SAYSO_DEMO === 'true'} />
      </main>
    );
  }

  const { guardStore } = await ready();
  const record = await guardStore.get(id);
  if (!record || record.action.ownerId !== shopId) {
    return (
      <main className="wrap wrap-narrow stack">
        <h1>Request not found</h1>
        <p className="soft">It doesn&apos;t belong to the shop you&apos;re signed in to.</p>
        <a href="/owner">Back to your shop</a>
      </main>
    );
  }

  const { action } = record;
  const pending = record.status === 'pending_approval';
  const decided = record.events.find((e) => e.type === 'approved' || e.type === 'rejected');
  const note = decided?.data?.note;
  const effects = (record.simulation?.effects ?? []).map((e) => e.replace(/^- /, ''));

  return (
    <main className="wrap wrap-narrow" style={{ paddingTop: 28, paddingBottom: 80 }}>
      <article className="sayso-card" style={{ maxWidth: 'none' }}>
        <div className="spread">
          <Who actor={action.actor} />
          <span className="small muted">{new Date(record.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="soft">{ACTION_LABEL[action.kind] ?? action.kind}</span>
          {action.amount !== undefined ? <span className="amount">{formatMoney(action.amount, action.currency ?? 'USD')}</span> : <h1>{ACTION_LABEL[action.kind]}</h1>}
          {action.counterparty && <span className="small soft">to {action.counterparty}</span>}
        </div>

        <p className="quote">&ldquo;{action.reason}&rdquo;</p>

        <ul className="facts">
          <li>
            <span>Would do</span>
            <span className="stack" style={{ gap: 4 }}>
              {effects.map((e) => (
                <span key={e}>{e}</span>
              ))}
            </span>
          </li>
          <li>
            <span>Needs you</span>
            <span className="stack" style={{ gap: 4 }}>
              {record.decision?.hits.map((h) => (
                <span key={h.ruleId + h.message}>{h.message}</span>
              ))}
            </span>
          </li>
        </ul>

        {pending ? (
          <Decision id={record.id} big />
        ) : (
          <div className="stack" style={{ gap: 14, alignItems: 'flex-start' }}>
            {decided ? (
              <span className={`stamp ${decided.type === 'approved' ? 'stamp-ok' : 'stamp-stop'}`}>
                {decided.type === 'approved' ? 'Approved' : 'Rejected'}
                <small>{new Date(decided.at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</small>
              </span>
            ) : (
              <Status value={record.status} />
            )}
            {typeof note === 'string' && <p className="small soft">Your note: {note}</p>}
            {record.verification && <p className="small soft">{record.verification.detail}</p>}
          </div>
        )}
      </article>

      <p className="small soft" style={{ marginTop: 18 }}>
        Request <span className="mono">{record.id}</span> · <a href="/owner#waiting">Everything waiting for you</a>
      </p>
    </main>
  );
}
