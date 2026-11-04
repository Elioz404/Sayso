'use client';

// The cart, in the Shop with AI panel: one cart per shop. Checkout asks the shop to price it (the same
// merchant-cart API assistants use, so shipping, tax and stock come from the shop), then PayPal's button
// pays for exactly that total. Changing the cart after that asks for a new price.

import { useEffect, useState } from 'react';
import { formatMoney, toMinor } from '@/core/money.ts';
import { callApi } from './api.ts';
import { cartStore, useCarts, type ShopCart } from './cart-store.ts';
import { PayPalCheckout, type Paid } from './paypal-checkout.tsx';
import { PurchaseCard, paymentWords, type Purchase } from './purchase-card.tsx';

type Money = { currency_code: string; value: string };
type Priced = {
  id: string;
  status: string;
  validation_issues?: { message: string; user_message?: string }[];
  totals?: { subtotal?: Money; shipping?: Money; tax?: Money; total?: Money };
  payment_method?: { approval_url?: string };
};
type Address = { name: string; email: string; line1: string; city: string; state: string; zip: string; country: string };

// A PayPal sandbox demo: a test address so judges can pay in two taps; anyone can change it.
const SANDBOX_ADDRESS: Address = { name: 'Alex Rivera', email: 'alex@example.com', line1: '1450 Mission St', city: 'San Francisco', state: 'CA', zip: '94103', country: 'US' };

const show = (m?: Money) => (m ? formatMoney(toMinor(m), m.currency_code) : '');

// Receipts for what was paid from the cart, kept in this browser (the newest few) until dismissed.
const RECEIPTS = 'sayso-receipts-v1';
type Receipt = Purchase & { id: string };

function useReceipts() {
  const [list, setList] = useState<Receipt[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECEIPTS) ?? '[]') as Receipt[];
      if (Array.isArray(saved)) setList(saved);
    } catch {
      // nothing saved, or storage is off
    }
  }, []);
  const update = (change: (list: Receipt[]) => Receipt[]) =>
    setList((list) => {
      const next = change(list).slice(0, 5);
      try {
        localStorage.setItem(RECEIPTS, JSON.stringify(next));
      } catch {
        // storage off: the receipt stays until the page changes
      }
      return next;
    });
  return { list, add: (r: Receipt) => update((l) => [r, ...l.filter((x) => x.id !== r.id)]), drop: (id: string) => update((l) => l.filter((x) => x.id !== id)) };
}

export function CartPanel({ paypalClientId, onAskAi }: { paypalClientId?: string; onAskAi: () => void }) {
  const carts = useCarts();
  const receipts = useReceipts();
  const shops = Object.entries(carts);
  // Just paid: the receipt comes first. With a new cart going, earlier receipts wait below it.
  const paid = receipts.list.length > 0 && (
    <div className="cart-receipts">
      {shops.length > 0 && <span className="small muted">Paid earlier</span>}
      {receipts.list.map((r) => (
        <PurchaseCard key={r.id} state="paid" data={r} onDismiss={() => receipts.drop(r.id)} />
      ))}
    </div>
  );

  return (
    <div className="cart">
      {shops.length === 0 && paid}
      {shops.length === 0 && (
        <div className="cart-empty">
          <b>Your cart is empty.</b>
          <button type="button" className="btn btn-small" onClick={onAskAi}>
            Ask AI to shop
          </button>
        </div>
      )}
      {shops.map(([slug, cart]) => (
        <ShopCartView
          key={slug}
          slug={slug}
          cart={cart}
          paypalClientId={paypalClientId}
          onPaid={(receipt) => {
            receipts.add(receipt);
            cartStore.clear(slug);
          }}
        />
      ))}
      {shops.length > 0 && paid}
    </div>
  );
}

function ShopCartView({ slug, cart, paypalClientId, onPaid }: { slug: string; cart: ShopCart; paypalClientId?: string; onPaid: (receipt: Receipt) => void }) {
  const [step, setStep] = useState<'items' | 'address'>('items');
  const [address, setAddress] = useState<Address>(SANDBOX_ADDRESS);
  const [priced, setPriced] = useState<{ cart: Priced; key: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const currency = cart.lines[0]?.currency ?? 'USD';
  const subtotal = cart.lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  // A price is only good for the cart it was given for.
  const key = JSON.stringify([cart.lines.map((l) => [l.variantId, l.qty]), address]);
  const quote = priced?.key === key ? priced.cart : undefined;
  const orderId = quote?.payment_method?.approval_url ? new URL(quote.payment_method.approval_url).searchParams.get('token') : null;

  async function price() {
    setBusy(true);
    setError(undefined);
    try {
      const body = {
        items: cart.lines.map((l) => ({ variant_id: l.variantId, quantity: l.qty })),
        shipping_address: { address_line_1: address.line1, admin_area_2: address.city, admin_area_1: address.state, postal_code: address.zip, country_code: address.country.toUpperCase() },
        customer: { email_address: address.email, name: { given_name: address.name.split(' ')[0], surname: address.name.split(' ').slice(1).join(' ') || undefined } },
      };
      // Tagged so the owner sees where the order came from.
      setPriced({ cart: await callApi<Priced>(`/api/shops/${slug}/merchant-cart`, 'POST', body, { 'X-Sayso-Channel': 'sayso-cart' }), key });
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  /** The receipt for this cart as it was paid: its lines, the shop's totals, PayPal's word on the payment. */
  const receiptOf = (paid: Paid): Receipt => ({
    id: paid.order ?? quote?.id ?? String(Date.now()),
    ...(quote?.id ? { cartId: quote.id } : {}),
    shop: cart.name,
    ...(paid.order ? { order: paid.order } : {}),
    lines: cart.lines.map((l) => ({ name: l.name, ...(l.variant ? { detail: l.variant } : {}), qty: l.qty, amount: formatMoney(l.price * l.qty, l.currency), ...(l.image ? { image: l.image } : {}) })),
    subtotal: show(quote?.totals?.subtotal),
    shipping: show(quote?.totals?.shipping),
    tax: show(quote?.totals?.tax),
    total: show(paid.total ?? quote?.totals?.total),
    status: `${paymentWords(paid.status)} Shipping to ${address.city}.`,
    paidAt: new Date().toISOString(),
  });

  const field = (name: keyof Address, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="cart-field">
      <span>{label}</span>
      <input value={address[name]} onChange={(e) => setAddress({ ...address, [name]: e.target.value })} disabled={busy} {...props} />
    </label>
  );

  return (
    <section className="cart-shop" aria-label={`Cart from ${cart.name}`}>
      <b>{cart.name}</b>
      <ul className="cart-lines">
        {cart.lines.map((l) => (
          <li key={l.variantId}>
            <span className="cart-thumb">{l.image && <img src={l.image} alt="" />}</span>
            <span className="stack" style={{ gap: 0, minWidth: 0 }}>
              <span className="cart-name">{l.name}</span>
              {l.variant && <span className="small muted">{l.variant}</span>}
            </span>
            <span className="cart-qty" role="group" aria-label={`Quantity of ${l.name}`}>
              <button type="button" onClick={() => cartStore.setQty(slug, l.variantId, l.qty - 1)} aria-label="One less">
                −
              </button>
              <span>{l.qty}</span>
              <button type="button" onClick={() => cartStore.setQty(slug, l.variantId, l.qty + 1)} disabled={l.qty >= l.max} aria-label="One more">
                +
              </button>
            </span>
            <span className="good-price">{formatMoney(l.price * l.qty, l.currency)}</span>
          </li>
        ))}
      </ul>

      {!quote && (
        <div className="spread small">
          <span className="soft">Subtotal, before shipping and tax</span>
          <b>{formatMoney(subtotal, currency)}</b>
        </div>
      )}

      {step === 'items' && (
        <button type="button" className="btn btn-primary" onClick={() => setStep('address')}>
          Checkout
        </button>
      )}

      {step === 'address' && !quote && (
        <form
          className="cart-address"
          onSubmit={(e) => {
            e.preventDefault();
            void price();
          }}
        >
          <p className="small soft">A sandbox test address is filled in.</p>
          {field('name', 'Name', { autoComplete: 'name', required: true })}
          {field('email', 'Email', { type: 'email', autoComplete: 'email', required: true })}
          {field('line1', 'Address', { autoComplete: 'address-line1', required: true })}
          <div className="cart-row">
            {field('city', 'City', { autoComplete: 'address-level2', required: true })}
            {field('state', 'State', { autoComplete: 'address-level1', maxLength: 3 })}
          </div>
          <div className="cart-row">
            {field('zip', 'ZIP', { autoComplete: 'postal-code', required: true })}
            {field('country', 'Country', { autoComplete: 'country', maxLength: 2, required: true })}
          </div>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Asking the shop…' : 'Get the total'}
          </button>
        </form>
      )}

      {error && <p className="small error">{error}</p>}

      {quote && (
        <div className="cart-quote">
          {quote.validation_issues?.map((i, k) => (
            <p key={k} className="small cart-issue">
              {i.user_message ?? i.message}
            </p>
          ))}
          <dl className="cart-totals">
            <dt>Subtotal</dt>
            <dd>{show(quote.totals?.subtotal)}</dd>
            <dt>Shipping</dt>
            <dd>{show(quote.totals?.shipping)}</dd>
            <dt>Tax</dt>
            <dd>{show(quote.totals?.tax)}</dd>
            <dt className="cart-total">Total</dt>
            <dd className="cart-total">{show(quote.totals?.total)}</dd>
          </dl>
          {orderId && quote.payment_method?.approval_url && paypalClientId ? (
            <PayPalCheckout clientId={paypalClientId} cartId={quote.id} orderId={orderId} currency={quote.totals?.total?.currency_code ?? currency} approvalUrl={quote.payment_method.approval_url} onPaid={(paid: Paid) => onPaid(receiptOf(paid))} />
          ) : (
            !quote.validation_issues?.length && <p className="small error">PayPal isn&apos;t available right now.</p>
          )}
          <button type="button" className="link-button small" onClick={() => setPriced(undefined)}>
            Change the address
          </button>
        </div>
      )}
    </section>
  );
}
