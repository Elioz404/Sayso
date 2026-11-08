// PayPal sends the buyer here after they approve (return_url). We complete the merchant-cart checkout
// server-side: re-check stock, authorize, capture through Guard.
import type { Metadata } from 'next';
import { PaidHere } from '@/app/_components/paid-here.tsx';
import { Icon } from '@/app/_components/ui.tsx';
import { HttpError } from '@/core/errors.ts';
import { formatMoney, toMinor } from '@/core/money.ts';
import { PAID_CLAIM, PAID_CLAIM_TTL_MS } from '@/server/buyer-session.ts';
import { ready } from '@/server/context.ts';
import { logError } from '@/server/log.ts';

export const metadata: Metadata = { title: 'Order' };

type Search = { cart?: string; token?: string };

export default async function PayReturn({ searchParams }: { searchParams: Promise<Search> }) {
  const { cart, token } = await searchParams;
  if (!cart || !token) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>This link is incomplete</h1>
        <p className="soft">It is missing the cart or the PayPal token. Go back to your assistant and open the payment link again.</p>
      </main>
    );
  }

  try {
    const services = await ready();
    const { result, settledNow } = await services.commerce.complete(cart, { items: [], payment_method: { type: 'paypal', token } });
    // Only the visit that took the payment may mark this browser as the buyer (a page can't set cookies, so
    // it hands the browser a signed claim that works once, for a few minutes).
    const claim = settledNow ? services.access.signValue(PAID_CLAIM, cart, PAID_CLAIM_TTL_MS) : undefined;
    const pending = result.payment_confirmation?.payment_status !== 'CAPTURED';
    const total = result.totals?.total;
    return (
      <main className="wrap wrap-narrow page">
        {claim && <PaidHere claim={claim} />}
        <article className="sayso-card" style={{ maxWidth: 'none' }}>
          <span className="row ok-text" style={{ gap: 8, fontWeight: 650 }}>
            <Icon name="check" size={20} /> Order placed
          </span>
          <div className="stack" style={{ gap: 6 }}>
            <span className="soft mono">{result.payment_confirmation?.merchant_order_number}</span>
            {total && <span className="amount">{formatMoney(toMinor(total), total.currency_code)}</span>}
            <span className="soft">{pending ? 'Authorized with PayPal. The shop confirms it shortly; you are charged only then.' : 'Paid with PayPal.'}</span>
          </div>
          <ul className="facts">
            {result.items.map((i) => (
              <li key={i.variant_id}>
                <span>{i.quantity}x</span>
                <span>{i.name}</span>
              </li>
            ))}
          </ul>
          <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <a className="btn btn-primary" href={`/order/${cart}`}>
              Track this order
            </a>
            <a className="btn" href="/orders">
              My orders
            </a>
          </div>
          <p className="small soft">Keep the order&apos;s link to come back to it, or go back to your assistant: it can tell you where it is too.</p>
        </article>
      </main>
    );
  } catch (err) {
    // A refusal Sayso made itself (stock, rules, an unapproved payment) happens before any charge. Anything
    // else is unexpected: say what we know and let the buyer check, never promise what we didn't verify.
    const refused = err instanceof HttpError && err.status < 500;
    if (!refused) logError(`checkout ${cart}`, err);
    return (
      <main className="wrap wrap-narrow page">
        <article className="sayso-card" style={{ maxWidth: 'none' }}>
          <h1>We couldn&apos;t complete this order</h1>
          {refused ? (
            <>
              <p className="soft">{err.message}.</p>
              <p>
                <b>You have not been charged.</b> Any hold on your PayPal account is released.
              </p>
            </>
          ) : (
            <p className="soft">
              Something went wrong while confirming it with PayPal. Reload this page in a minute to try again; if PayPal shows a payment, the shop
              sees it too. Your reference: <span className="mono">{cart}</span>
            </p>
          )}
        </article>
      </main>
    );
  }
}
