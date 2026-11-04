// PayPal sends the buyer here after they approve saving their PayPal. Finish the connection and hand
// the buyer their personal shopping URL, once. A reload just shows the wallet page.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { CopyField } from '@/app/_components/client-ui.tsx';
import { Status } from '@/app/_components/ui.tsx';
import { HttpError } from '@/core/errors.ts';
import { formatMoney } from '@/core/money.ts';
import { ready } from '@/server/context.ts';
import { logError } from '@/server/log.ts';
import { holdsWallet } from '@/server/wallet-session.ts';

export const metadata: Metadata = { title: 'PayPal connected' };

export default async function WalletReturn({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { wallets } = await ready();
  if (!(await holdsWallet(id))) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>Finish where you started</h1>
        <p className="soft">Open this in the browser where you chose your limits. Nothing was saved and nothing was charged.</p>
      </main>
    );
  }
  let result: Awaited<ReturnType<typeof wallets.finishConnect>> | undefined;
  let problem: string | undefined;
  try {
    result = await wallets.finishConnect(id);
  } catch (err) {
    problem = err instanceof HttpError ? err.message : 'PayPal could not finish saving your account';
    logError('wallet connect', err);
  }
  if (problem || !result) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>That didn&apos;t finish</h1>
        <p className="soft">{problem}. Nothing was saved and nothing was charged.</p>
        <a href={`/wallet/${id}`}>Try again</a>
      </main>
    );
  }
  if (!result.connectorKey) redirect(`/wallet/${id}`);
  const { wallet, connectorKey, pairingCode } = result;
  const money = (minor: number) => formatMoney(minor, wallet.limits.currency);

  return (
    <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <Status value="live" />
        <h1>Your PayPal is saved</h1>
        <p className="soft">
          Up to {money(wallet.limits.perOrder)} an order and {money(wallet.limits.daily)} a day. Anything bigger still comes to you for approval in PayPal.
        </p>
      </div>

      {pairingCode && (
        <section className="panel stack" style={{ gap: 'var(--s3)' }}>
          <h2>Give this code to your assistant</h2>
          <p className="small soft">
            Paste it into your chat with <b>{wallet.label}</b>. Only then can it pay for you. If you didn’t start this from your own assistant, don’t share it:
            nobody can spend without it, and you can disconnect below.
          </p>
          <CopyField value={pairingCode} />
          <p className="small muted">It works once, for 30 minutes.</p>
        </section>
      )}

      <section className="panel stack" style={{ gap: 'var(--s4)' }}>
        <h2>Keep it connected in every chat</h2>
        <p className="small soft">
          Add this as a connector in ChatGPT or any MCP client, in place of the plain shopping link. Your assistant can then pay inside your limits
          in any conversation, without remembering anything.
        </p>
        <CopyField value={wallets.personalUrl(connectorKey)} secret />
        <p className="small muted">Treat it like a password. It is shown only now. Disconnecting PayPal makes it a plain shopping link again.</p>
      </section>

      <a href={`/wallet/${id}`}>See or disconnect your saved PayPal</a>
    </main>
  );
}
