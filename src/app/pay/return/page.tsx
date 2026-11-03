// PayPal sends the buyer here after they approve (return_url). We complete the merchant-cart checkout
// server-side: re-check stock, authorize, capture through Guard.
import type { Metadata } from 'next';
import { Icon } from '@/app/_components/ui.tsx';
import { HttpError } from '@/core/commerce.ts';
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
    const message = err instanceof HttpError ? err.message : 'Something went wrong';
    return (
      <main className="wrap wrap-narrow page">
        <article className="sayso-card" style={{ maxWidth: 'none' }}>
          <h1>We couldn&apos;t complete this order</h1>
          <p className="soft">{message}.</p>
          <p>
            <b>You have not been charged.</b> Any hold on your PayPal account is released.
          </p>
        </article>
      </main>
    );
  }
}
