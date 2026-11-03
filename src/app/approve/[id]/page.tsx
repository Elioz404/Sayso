// The owner's say-so screen, built for a phone: this is where the push notification lands. It needs
// the owner session; an agent holding an agent key has no way in.
import { connection } from 'next/server';
import { Decision, LoginForm } from '@/app/_components/owner-actions.tsx';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { ownerShopId } from '@/server/http.ts';

const TITLES: Record<string, string> = {
  'refund.create': 'Refund',
  'payment.capture': 'Charge an order',
  'payment.void': 'Release a payment hold',
  'policy.update': 'Change your rules',
  'dispute.accept': 'Accept a dispute',
  'invoice.send': 'Send an invoice',
  'checkout.create': 'Purchase',
};

export default async function Approve({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const shopId = await ownerShopId();
  if (!shopId) {
    return (
      <main className="narrow">
        <h1>Sign in to decide</h1>
        <LoginForm demo={process.env.SAYSO_DEMO === 'true'} />
      </main>
    );
  }

  const { guardStore } = await ready();
  const record = await guardStore.get(id);
  if (!record || record.action.ownerId !== shopId) {
    return (
      <main className="narrow">
        <h1>Not found</h1>
        <p className="muted">This request doesn&apos;t belong to the shop you&apos;re signed in to.</p>
      </main>
    );
  }

  const { action } = record;
  const who = action.actor.type === 'agent' ? `Your agent "${action.actor.id.split(':')[1] ?? action.actor.id}"` : action.actor.id === 'sayso-ops-agent' ? 'Sayso checkout' : action.actor.id;
  const decided = record.events.find((e) => e.type === 'approved' || e.type === 'rejected');

  return (
    <main className="narrow">
      <p className="muted small">{who} asks for your say-so</p>
      <h1>{TITLES[action.kind] ?? action.kind}</h1>
      {action.amount !== undefined && <div className="amount">{formatMoney(action.amount, action.currency ?? 'USD')}</div>}
      {action.counterparty && <p className="muted">to {action.counterparty}</p>}

      <div className="card">
        <h3>Reason given</h3>
        <p>{action.reason}</p>
        <h3>What would happen</h3>
        <ul>{record.simulation?.effects.map((e) => <li key={e}>{e.replace(/^- /, '')}</li>)}</ul>
        <h3>Why it needs you</h3>
        <ul>{record.decision?.hits.map((h) => <li key={h.ruleId + h.message}>{h.message}</li>)}</ul>
      </div>

      {record.status === 'pending_approval' ? (
        <Decision id={record.id} big />
      ) : (
        <div className="card">
          <span className={`pill ${record.status}`}>{record.status.replace('_', ' ')}</span>
          {decided && <p className="small muted" style={{ marginTop: 8 }}>{decided.type} {new Date(decided.at).toLocaleString('en-US')}</p>}
          {record.verification && <p className="small">{record.verification.detail}</p>}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 18 }}>
        Request <code>{record.id}</code> · <a href="/owner">All requests</a>
      </p>
    </main>
  );
}
