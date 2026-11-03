'use client';

// Buttons of the judges' tour: start it, and run each step. The steps run on the server; this only asks
// and refreshes the page to show what happened.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api.ts';
import { Icon } from './ui.tsx';

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(url: string) {
    setBusy(true);
    setError(undefined);
    try {
      await callApi(url, 'POST');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }
  return { busy, error, run };
}

export function StartTour() {
  const { busy, error, run } = useAction();
  return (
    <div className="stack" style={{ gap: 'var(--s2)' }}>
      <button className="btn btn-primary btn-big" disabled={busy} onClick={() => run('/api/tour')}>
        {busy ? 'Making your copy of the shop...' : 'Start the tour'} <Icon name="arrow" size={17} />
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export function RunStep({ step, label }: { step: string; label: string }) {
  const { busy, error, run } = useAction();
  return (
    <div className="stack" style={{ gap: 'var(--s2)', alignItems: 'flex-start' }}>
      <button className="btn btn-primary" disabled={busy} onClick={() => run(`/api/tour/${step}`)}>
        {busy ? 'The agent is working...' : label}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
