'use client';

// Buttons of For Judges: run one of the agents' steps on the judge's shop, and open the demo shop's
// dashboard to see a purchase from the shop's side. The steps run on the server; this only asks, then
// shows the page again where the judge was.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api.ts';

/** `screen`: where to come back to, e.g. /tour#sell. */
export function RunStep({ step, label, screen }: { step: string; label: string; screen: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="stack" style={{ gap: 'var(--s2)', alignItems: 'flex-start' }}>
      <button
        className="btn btn-primary btn-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await callApi(`/api/tour/${step}`, 'POST');
            router.replace(screen, { scroll: false });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? 'The agent is working…' : label}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** The demo shop's dashboard (a shared, read-mostly session), on its orders. */
export function OpenDemoShop() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="stack" style={{ gap: 'var(--s2)', alignItems: 'flex-start' }}>
      <button
        className="btn btn-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await callApi('/api/owner/session', 'POST', { demo: true });
            window.location.href = '/owner/orders';
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Opening…' : "Open the shop's dashboard"}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
