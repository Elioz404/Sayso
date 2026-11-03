// The owner's say-so screen, built for a phone: this is where the push notification lands. It needs
// the owner session; an agent holding an agent key has no way in.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Decision, LoginForm } from '@/app/_components/owner-actions.tsx';
import { actionLabel, Status, Who } from '@/app/_components/ui.tsx';
import { When } from '@/app/_components/time.tsx';
import { DEFAULT_CURRENCY, formatMoney } from '@/core/money.ts';
import { paypalLoginEnabled } from '@/server/context.ts';
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
        <LoginForm demo={process.env.SAYSO_DEMO === 'true'} paypal={paypalLoginEnabled()} next={`/approve/${id}`} />
      </main>
    );
  }

  const { redact } = view;
  const onTour = Boolean(await view.tours?.forShop(view.shopId));
  const record = await view.saySo.record(view.shopId, id).catch(() => undefined);
  if (!record) {
    return (
      <main className="wrap wrap-narrow page stack">
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
  const effects = (record.simulation?.effects ?? []).map((e) => redact(e.replace(/^- /, '')));

  return (
    <main className="wrap wrap-narrow page" style={{ paddingTop: 'var(--s6)' }}>
      <article className="sayso-card" style={{ maxWidth: 'none' }}>
        <div className="spread">
          <Who actor={action.actor} />
          <span className="small muted">
            <When iso={record.createdAt} />
          </span>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="soft">{actionLabel(action.kind)}</span>
          {action.amount !== undefined ? <span className="amount">{formatMoney(action.amount, action.currency ?? DEFAULT_CURRENCY)}</span> : <h1>{actionLabel(action.kind)}</h1>}
          {action.counterparty && <span className="small soft">to {redact(action.counterparty)}</span>}
        </div>

        <p className="reason">&ldquo;{redact(action.reason)}&rdquo;</p>

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
            <span className="stack needs" style={{ gap: 4 }}>
              {record.decision?.hits.map((h) => (
                <span key={h.ruleId + h.message}>{redact(h.message)}</span>
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
                <small>
                  <When iso={decided.at} />
                </small>
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
        {onTour && (
          <>
            {' '}
            · <a href="/tour">Back to the tour</a>
          </>
        )}
      </p>
    </main>
  );
}
