'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Approve / reject buttons for one pending Guard record. */
export function GuardActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(undefined);
    const res = await fetch(`/api/guard/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).message ?? `Error ${res.status}`);
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="primary" disabled={busy} onClick={() => decide('approve')}>Say OK</button>
      <button disabled={busy} onClick={() => decide('reject')}>Reject</button>
      {error && <span className="status failed">{error}</span>}
    </div>
  );
}
