'use client';

// "Ask for a refund" on a buyer's order page: it sends the request to the shop owner, who decides, the
// same way an assistant's request_refund does. Nothing is refunded until they say yes.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api.ts';

export function RefundAsk({ orderId, total }: { orderId: string; total?: string }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  if (sent) return <p className="small ok-text">Sent to the shop. You&apos;ll see their answer here; PayPal refunds you if they agree.</p>;
  return (
    <details className="refund-ask">
      <summary>Something wrong? Ask for a refund</summary>
      <form
        className="stack"
        style={{ gap: 'var(--s3)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            await callApi(`/api/orders/${orderId}/refund`, 'POST', { reason, amount });
            setSent(true);
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <div className="field">
          <label htmlFor="refund-reason">What happened?</label>
          <textarea id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={300} rows={3} required placeholder="The mug arrived with a cracked handle." />
        </div>
        <div className="field">
          <label htmlFor="refund-amount">How much (optional)</label>
          <input id="refund-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" maxLength={20} placeholder={total ? `Up to ${total}; leave empty for all of it` : 'Leave empty for all of it'} />
        </div>
        {error && <p className="small error">{error}</p>}
        <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={busy || reason.trim().length < 5}>
            {busy ? 'Sending…' : 'Send to the shop'}
          </button>
          <span className="small muted">The shop owner decides. Nothing is refunded until they say yes.</span>
        </div>
      </form>
    </details>
  );
}
