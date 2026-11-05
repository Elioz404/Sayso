// The owner allows an AI app (ChatGPT, Claude...) to run their shop as an agent. Signing in first if
// needed; the shared demo can't. Allowing gives the app an agent key of its own, listed under Agents.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { LoginForm, ShopSwitcher } from '@/app/_components/owner-actions.tsx';
import { ConsentAnswer } from '@/app/_components/consent-answer.tsx';
import { unpackRequest } from '@/core/oauth.ts';
import { ownerSession } from '@/server/http.ts';
import { paypalLoginEnabled, ready } from '@/server/context.ts';
import { ownerView, signedInSeller } from '@/server/owner.ts';

export const metadata: Metadata = { title: 'Connect an AI app', robots: { index: false } };

export default async function Consent({ params }: { params: Promise<{ request: string }> }) {
  await connection();
  const { request: packed } = await params;
  const { access } = await ready();
  const request = unpackRequest(access, packed);
  if (!request) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>This request expired</h1>
        <p className="soft">Go back to the app and connect again.</p>
      </main>
    );
  }
  const app = request.client.name ?? 'An AI app';
  const host = new URL(request.redirectUri).host;
  const view = await ownerView();

  if (!view || view.demo) {
    return (
      <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <h1>Connect {app} to your shop</h1>
          <p className="soft">{view?.demo ? "The shared demo shop can't connect agents. Sign in to your own shop." : 'Sign in to the shop it should run.'}</p>
        </div>
        <LoginForm demo={false} paypal={paypalLoginEnabled()} next={`/oauth/consent/${packed}`} />
      </main>
    );
  }

  const [seller, session, passkey] = await Promise.all([signedInSeller(), ownerSession(), view.passkeys.required(view.shopId)]);
  // Same step-up as making a key by hand: the passkey, or a sign-in on this device in the last 30 minutes.
  const canAllow = Boolean(session && session.via !== 'handoff' && (passkey || access.isFresh(session)));
  return (
    <main className="wrap wrap-narrow page">
      <section className="panel consent" aria-labelledby="consent-title">
        <div className="stack" style={{ gap: 'var(--s2)' }}>
          <h1 id="consent-title" className="consent-title">
            Let {app} run {view.shop.name}?
          </h1>
          <p className="small soft">It gets an agent key of its own. You see what it does under Agents and Activity, and can revoke it there.</p>
        </div>
        {seller && seller.shops.length > 1 && (
          <div className="field">
            <span className="field-label">Shop</span>
            <ShopSwitcher shops={seller.shops} current={view.shop.slug} />
          </div>
        )}
        <dl className="consent-lines">
          <dt>On its own</dt>
          <dd>Orders and sales, prices and stock, what to make next, tracking numbers.</dd>
          <dt>Within your rules</dt>
          <dd>Refunds and invoices. Past your rules, it waits for your OK.</dd>
          <dt>Never</dt>
          <dd>Saying OK for you, changing your rules, publishing.</dd>
        </dl>
        <p className="small muted">
          You go back to <b>{host}</b> afterwards.
        </p>
        {canAllow ? (
          <ConsentAnswer request={packed} passkey={passkey} />
        ) : (
          <div className="stack" style={{ gap: 'var(--s3)' }}>
            <p className="small soft">For your safety, allowing an app works for 30 minutes after you sign in. Sign in again to continue.</p>
            <LoginForm demo={false} paypal={paypalLoginEnabled()} next={`/oauth/consent/${packed}`} />
          </div>
        )}
      </section>
    </main>
  );
}
