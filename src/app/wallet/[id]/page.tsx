// A buyer's saved PayPal for their assistant: set limits and connect, or see and disconnect it.
// The link is what the assistant handed the buyer; the PayPal approval is what makes it real.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ConnectForm, DisconnectButton } from '@/app/_components/wallet-actions.tsx';
import { Status } from '@/app/_components/ui.tsx';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Saved PayPal' };

export default async function WalletPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cancelled?: string }> }) {
  await connection();
  const { id } = await params;
  const { cancelled } = await searchParams;
  const wallet = await (await ready()).wallets.get(id).catch(() => undefined);
  if (!wallet) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>Link not found</h1>
        <p className="soft">Ask your assistant to set up PayPal again.</p>
      </main>
    );
  }
  const money = (minor: number) => formatMoney(minor, wallet.limits.currency);
  const plain = (minor: number) => (minor / 100).toFixed(minor % 100 ? 2 : 0);

  if (wallet.status === 'connected') {
    return (
      <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <Status value="live" />
          <h1>{wallet.label} can pay for you</h1>
          <p className="soft">With your PayPal account{wallet.payerEmail ? ` ${wallet.payerEmail}` : ''}, at small shops on Sayso.</p>
        </div>
        <div className="panel">
          <dl className="kv">
            <dt>Per order</dt>
            <dd>
              <b>{money(wallet.limits.perOrder)}</b>
            </dd>
            <dt>Per day</dt>
            <dd>
              <b>{money(wallet.limits.daily)}</b>
            </dd>
            <dt>Above that</dt>
            <dd>You approve each order in PayPal</dd>
            <dt>Connected</dt>
            <dd>{wallet.connectedAt ? new Date(wallet.connectedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}</dd>
          </dl>
        </div>
        <DisconnectButton walletId={wallet.id} label={wallet.label} />
        <p className="small muted">To change the limits, disconnect and connect again.</p>
      </main>
    );
  }

  return (
    <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <h1>Let {wallet.label} pay for you</h1>
        <p className="lede">
          Your assistant asked to pay for small-shop orders with your PayPal, so you don&apos;t have to approve every purchase. Choose how far it can go
          on its own.
        </p>
      </div>
      {cancelled && <div className="callout">You cancelled in PayPal. Nothing was saved.</div>}
      {wallet.status === 'disconnected' && <div className="callout">You disconnected PayPal. You can connect it again below.</div>}
      <ConnectForm walletId={wallet.id} perOrder={plain(wallet.limits.perOrder)} daily={plain(wallet.limits.daily)} label={wallet.label} />
    </main>
  );
}
