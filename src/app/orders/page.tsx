// "My orders" without a Sayso account: sign in with the PayPal account you paid with and see every order
// it paid for, in every shop, from any browser. PayPal says who you are; Sayso matches the orders PayPal
// said that account paid for. Orders paid in this browser show here too, signed in or not.
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { OrderList } from '@/app/_components/order-list.tsx';
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
  const { paypalLogin } = await ready();
  const who = await buyerSession();
  const note = SIGNIN[(await searchParams).signin ?? ''];

  return (
    <main className="wrap wrap-narrow page stack" style={{ gap: 'var(--s5)' }}>
      <header className="stack" style={{ gap: 'var(--s2)' }}>
        <h1>My orders</h1>
        <p className="soft">No account to make: the PayPal account you paid with is how Sayso knows which orders are yours.</p>
        {note && <p className="small notice">{note}</p>}
      </header>

      {who ? (
        <form action="/api/orders/signout" method="post" className="row small" style={{ gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <span className="muted">Signed in with PayPal as {who.email ?? who.name ?? 'your PayPal account'}.</span>
          <button className="link-button">Sign out</button>
        </form>
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

      <OrderList pageSize={10} />
    </main>
  );
}
