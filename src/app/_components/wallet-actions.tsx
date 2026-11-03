'use client';

// The buyer's side of a saved PayPal: choose limits and go to PayPal, or disconnect.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api.ts';
import { Icon } from './ui.tsx';

export function ConnectForm({ walletId, perOrder, daily, label }: { walletId: string; perOrder: string; daily: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="panel stack"
      style={{ gap: 'var(--s5)' }}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setBusy(true);
        setError(undefined);
        try {
          const { url } = await callApi<{ url: string }>(`/api/wallets/${walletId}/connect`, 'POST', { perOrder: form.get('perOrder'), daily: form.get('daily') });
          window.location.href = url;
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <div className="field-row">
        <div className="field">
          <label htmlFor="perOrder">Up to, per order (USD)</label>
          <input id="perOrder" name="perOrder" defaultValue={perOrder} inputMode="decimal" required />
        </div>
        <div className="field">
          <label htmlFor="daily">Up to, per day (USD)</label>
          <input id="daily" name="daily" defaultValue={daily} inputMode="decimal" required />
        </div>
      </div>
      <p className="small soft">
        Inside these limits {label} pays without asking. Anything bigger comes back to you as a normal PayPal approval. You can disconnect here at any time.
      </p>
      <div className="row" style={{ gap: 'var(--s3)' }}>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Opening PayPal...' : 'Continue to PayPal'} <Icon name="arrow" size={17} />
        </button>
        <span className="small muted">You approve once, in PayPal.</span>
      </div>
      {error && <p className="error small">{error}</p>}
    </form>
  );
}

export function DisconnectButton({ walletId, label }: { walletId: string; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  if (!confirming) {
    return (
      <button className="btn btn-danger" onClick={() => setConfirming(true)}>
        Disconnect PayPal
      </button>
    );
  }
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <span className="small">{label} won&apos;t be able to pay for you any more. Every purchase will need your approval in PayPal again.</span>
      <div className="row">
        <button
          className="btn btn-danger"
          onClick={async () => {
            try {
              await callApi(`/api/wallets/${walletId}/disconnect`);
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          Disconnect now
        </button>
        <button className="btn btn-quiet" onClick={() => setConfirming(false)}>
          Keep it
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
