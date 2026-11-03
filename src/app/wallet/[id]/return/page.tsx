// PayPal sends the buyer here after they approve saving their PayPal. Finish the connection, then show
// the same page as a connected wallet.
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { HttpError } from '@/core/commerce.ts';
import { ready } from '@/server/context.ts';

export default async function WalletReturn({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  let problem: string | undefined;
  try {
    await (await ready()).wallets.finishConnect(id);
  } catch (err) {
    problem = err instanceof HttpError ? err.message : 'PayPal could not finish saving your account';
    console.error('[wallet] finish connect failed', err);
  }
  if (!problem) redirect(`/wallet/${id}`);
  return (
    <main className="wrap wrap-narrow page stack">
      <h1>That didn&apos;t finish</h1>
      <p className="soft">{problem}. Nothing was saved and nothing was charged.</p>
      <a href={`/wallet/${id}`}>Try again</a>
    </main>
  );
}
