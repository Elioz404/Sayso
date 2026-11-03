import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Checkout cancelled' };

export default function PayCancel() {
  return (
    <main className="wrap wrap-narrow page">
      <article className="sayso-card" style={{ maxWidth: 'none' }}>
        <h1>Checkout cancelled</h1>
        <p className="soft">Nothing was charged. Your assistant can pick the cart up again whenever you are ready.</p>
      </article>
    </main>
  );
}
