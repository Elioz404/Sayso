// "My orders" without a Sayso account: sign in with the PayPal account you paid with and see every order
// it paid for, in every shop, from any browser. PayPal says who you are; Sayso matches the orders PayPal
// said that account paid for. Orders paid in this browser show here too, signed in or not.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { BrowserOrders } from '@/app/_components/browser-orders.tsx';
import { OrderRow } from '@/app/_components/order-view.tsx';
import { buyerOrders } from '@/core/buyer-orders.ts';
import { buyerSession } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'My orders', robots: { index: false, follow: false } };

const SIGNIN: Record<string, string> = {
  cancelled: 'You closed PayPal before signing in.',
  failed: "PayPal sign-in didn't work this time. Try again in a moment.",
  expired: 'That sign-in took too long. Try again.',
  off: "Signing in with PayPal isn't set up on this server. Orders paid in this browser are below.",
  out: 'Signed out. Your orders stay with PayPal and with the shops.',
};

export default async function MyOrders({ searchParams }: { searchParams: Promise<{ signin?: string }> }) {
  await connection();
  const { carts, catalogs, orders, links, paypalLogin } = await ready();
  const who = await buyerSession();
  const mine = who ? await buyerOrders({ carts, catalogs, orders, links }, who) : [];
  const note = SIGNIN[(await searchParams).signin ?? ''];

  return (
    <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s6)' }}>
      <header className="stack" style={{ gap: 'var(--s2)' }}>
        <h1>My orders</h1>
        <p className="soft">No account to make: the PayPal account you paid with is how Sayso knows which orders are yours.</p>
        {note && <p className="small notice">{note}</p>}
      </header>

      {who ? (
        <section className="stack" style={{ gap: 'var(--s3)' }} aria-labelledby="paypal-orders">
          <div className="spread" style={{ flexWrap: 'wrap', gap: 'var(--s2)' }}>
            <h2 id="paypal-orders" className="h3">
              Paid with your PayPal
            </h2>
            <form action="/api/orders/signout" method="post" className="row small" style={{ gap: 'var(--s2)' }}>
              <span className="muted">Signed in as {who.email ?? who.name ?? 'your PayPal account'}</span>
              <button className="link-button">Sign out</button>
            </form>
          </div>
          {mine.length ? (
            <ul className="orows">
              {mine.map((o) => (
                <OrderRow key={o.id} order={o} />
              ))}
            </ul>
          ) : (
            <p className="small muted">No orders paid with this PayPal account yet.</p>
          )}
        </section>
      ) : (
        paypalLogin && (
          <section className="order-card order-signin" aria-labelledby="signin">
            <div className="stack" style={{ gap: 6 }}>
              <h2 id="signin" className="h3">
                See every order, from any browser
              </h2>
              <p className="small soft">
                Sign in with the PayPal account you paid with. PayPal tells Sayso who you are, and you see each order in every shop: where it is,
                tracking and refunds. Nothing else is shared, and there&apos;s no password to keep.
              </p>
            </div>
            <a className="btn btn-paypal" href="/api/orders/signin">
              Log in with PayPal
            </a>
          </section>
        )
      )}

      <section className="stack" style={{ gap: 'var(--s3)' }} aria-labelledby="here">
        <h2 id="here" className="h3">
          {who ? 'Also paid in this browser' : 'Paid in this browser'}
        </h2>
        <BrowserOrders exclude={mine.map((o) => o.id)} />
      </section>
    </main>
  );
}
