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

export const metadata: Metadata = { title: 'PayPal connected' };

export default async function WalletReturn({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const { wallets } = await ready();
  let result: Awaited<ReturnType<typeof wallets.finishConnect>> | undefined;
  let problem: string | undefined;
  try {
    result = await wallets.finishConnect(id);
  } catch (err) {
    problem = err instanceof HttpError ? err.message : 'PayPal could not finish saving your account';
    console.error('[wallet] finish connect failed', err);
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
  const { wallet, connectorKey } = result;
  const money = (minor: number) => formatMoney(minor, wallet.limits.currency);

  return (
    <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
      <div className="stack" style={{ gap: 'var(--s2)' }}>
        <Status value="live" />
        <h1>{wallet.label} can pay for you</h1>
        <p className="soft">
          Up to {money(wallet.limits.perOrder)} an order and {money(wallet.limits.daily)} a day. Anything bigger still comes to you for approval in PayPal.
        </p>
      </div>

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
