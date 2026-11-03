// PayPal sends the buyer here after they approve (return_url). We complete the merchant-cart checkout
// server-side: re-check stock, authorize, capture through Guard.
import { ctx } from '@/server/context.ts';
import { HttpError } from '@/core/commerce.ts';

type Search = { cart?: string; token?: string; PayerID?: string };

export default async function PayReturn({ searchParams }: { searchParams: Promise<Search> }) {
  const { cart, token, PayerID } = await searchParams;
  if (!cart || !token) return <p>Missing cart or PayPal token.</p>;

  try {
    const result = await ctx().commerce.checkout(cart, {
      items: [],
      payment_method: { type: 'paypal', token, payer_id: PayerID },
    });
    const pending = result.payment_confirmation?.payment_status !== 'CAPTURED';
    return (
      <div className="card">
        <h1>Order {result.payment_confirmation?.merchant_order_number} placed</h1>
        <p>
          {result.totals?.total.value} {result.totals?.total.currency_code} paid with PayPal
          {pending ? ' (authorized; the shop confirms it shortly)' : ''}.
        </p>
        <p className="muted">You can close this tab and return to your assistant.</p>
      </div>
    );
  } catch (err) {
    const message = err instanceof HttpError ? err.message : 'Something went wrong';
    return (
      <div className="card">
        <h1>We couldn&apos;t complete this order</h1>
        <p>{message}. You have not been charged.</p>
      </div>
    );
  }
}
