// PayPal sends the buyer here after they approve (return_url). We complete the merchant-cart checkout
// server-side: re-check stock, authorize, capture through Guard.
import type { Metadata } from 'next';
import { Icon } from '@/app/_components/ui.tsx';
import { HttpError } from '@/core/errors.ts';
import { formatMoney, toMinor } from '@/core/money.ts';
import { ready } from '@/server/context.ts';

export const metadata: Metadata = { title: 'Order' };

type Search = { cart?: string; token?: string; PayerID?: string };

export default async function PayReturn({ searchParams }: { searchParams: Promise<Search> }) {
  const { cart, token, PayerID } = await searchParams;
  if (!cart || !token) {
    return (
      <main className="wrap wrap-narrow page stack">
        <h1>This link is incomplete</h1>
        <p className="soft">It is missing the cart or the PayPal token. Go back to your assistant and open the payment link again.</p>
      </main>
    );
  }

  try {
    const result = await (await ready()).commerce.checkout(cart, {
      items: [],
      payment_method: { type: 'paypal', token, payer_id: PayerID },
    });
    const pending = result.payment_confirmation?.payment_status !== 'CAPTURED';
    const total = result.totals?.total;
    return (
      <main className="wrap wrap-narrow page">
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
          <p className="small soft">You can close this tab and go back to your assistant.</p>
        </article>
      </main>
    );
  } catch (err) {
    // A refusal Sayso made itself (stock, rules, an unapproved payment) happens before any charge. Anything
    // else is unexpected: say what we know and let the buyer check, never promise what we didn't verify.
    const refused = err instanceof HttpError && err.status < 500;
    if (!refused) console.error(`[checkout] return for ${cart} failed`, err);
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
