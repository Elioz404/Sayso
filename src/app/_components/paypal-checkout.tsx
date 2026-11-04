'use client';

// PayPal's own checkout button (JS SDK) for a cart Sayso already priced and turned into a PayPal order.
// The buyer approves in PayPal's window without leaving the page; then Sayso completes the order exactly
// like the return page PayPal redirects to (stock re-checked, Guard authorizes and captures). Used by the
// assistant's chat and by the cart.

import { useEffect, useRef, useState } from 'react';
import { callApi } from './api.ts';

declare global {
  interface Window {
    paypal?: { Buttons(options: Record<string, unknown>): { render(el: HTMLElement): Promise<void> } };
  }
}

/** PayPal's JS SDK, loaded once per page (and currency). */
const sdk = new Map<string, Promise<void>>();
function loadPayPal(clientId: string, currency: string): Promise<void> {
  const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=authorize&components=buttons&disable-funding=card,paylater,venmo`;
  if (!sdk.has(src)) {
    sdk.set(
      src,
      new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = src;
        tag.onload = () => resolve();
        tag.onerror = () => reject(new Error("PayPal's button didn't load. Use the link in the message instead."));
        document.head.appendChild(tag);
      }),
    );
  }
  return sdk.get(src)!;
}

export type Paid = { order?: string; status?: string; total?: { value: string; currency_code: string } };

/**
 * PayPal's own button for the cart's PayPal order: the buyer approves in PayPal's window without leaving
 * the chat, then Sayso completes the order exactly as the return page would (stock, Guard, capture).
 */
export function PayPalCheckout({ clientId, cartId, orderId, currency, approvalUrl, onPaid }: { clientId: string; cartId: string; orderId: string; currency: string; approvalUrl: string; onPaid: (paid: Paid) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let gone = false;
    loadPayPal(clientId, currency)
      .then(() => {
        if (gone || !box.current || !window.paypal) return;
        box.current.innerHTML = '';
        return window.paypal
          .Buttons({
            style: { layout: 'horizontal', tagline: false, shape: 'pill', color: 'gold', label: 'pay', height: 44 },
            createOrder: () => orderId,
            onApprove: async (data: { orderID: string }) => {
              try {
                onPaid(await callApi<Paid>('/api/pay/complete', 'POST', { cart: cartId, token: data.orderID }));
              } catch (err) {
                setError((err as Error).message);
              }
            },
            onError: () => setError('PayPal could not open this payment. Use the link in the message instead.'),
          })
          .render(box.current);
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      gone = true;
    };
  }, [clientId, cartId, orderId, currency, onPaid]);
  return (
    <div className="shopper-checkout">
      <div ref={box} />
      {error && <p className="small error">{error}</p>}
      <a className="small muted" href={approvalUrl} target="_blank" rel="noopener noreferrer">
        Or open PayPal in a new tab
      </a>
    </div>
  );
}
