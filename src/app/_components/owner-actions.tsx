'use client';

// Small client islands for owner actions. Each one calls an owner-only API route (signed session
// cookie) and refreshes the server-rendered page.

import { useRouter } from 'next/navigation';
import { useState } from 'react';

async function send(url: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
  return data;
}

export function LoginForm({ demo, defaultShop }: { demo: boolean; defaultShop?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function login(body: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      await send('/api/owner/session', 'POST', body);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        void login({ shop: form.get('shop'), secret: form.get('secret') });
      }}
    >
      <h3>Owner sign-in</h3>
      <p className="muted small">Only the owner signs in here. Your AI agent uses its own key and can never approve anything.</p>
      <label htmlFor="shop">Shop</label>
      <input id="shop" name="shop" defaultValue={defaultShop} placeholder="your-shop-1a2b" autoComplete="username" required />
      <label htmlFor="secret">Owner secret</label>
      <input id="secret" name="secret" type="password" placeholder="sk_owner_..." autoComplete="current-password" required />
      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" disabled={busy}>Sign in</button>
        {demo && (
          <button type="button" disabled={busy} onClick={() => void login({ demo: true })}>
            Open the demo shop
          </button>
        )}
      </div>
      {error && <p className="error small" style={{ marginTop: 10 }}>{error}</p>}
    </form>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await send('/api/owner/session', 'DELETE').catch(() => {});
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

export function Decision({ id, big = false }: { id: string; big?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState('');

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true);
    setError(undefined);
    try {
      await send(`/api/guard/${id}`, 'POST', { decision, note: note || undefined });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      {big && <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional, saved in the audit log)" maxLength={300} />}
      <div className="row">
        <button className={`primary${big ? ' big' : ''}`} disabled={busy} onClick={() => void decide('approve')}>
          Say OK
        </button>
        <button className={`danger${big ? ' big' : ''}`} disabled={busy} onClick={() => void decide('reject')}>
          Reject
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export function PublishButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  return (
    <div className="stack">
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await send('/api/owner/publish', 'POST');
            setMessage(res.warnings.length ? res.warnings.join(' ') : undefined);
            router.refresh();
          } catch (err) {
            setMessage((err as Error).message);
          }
          setBusy(false);
        }}
      >
        Publish: open to AI shoppers
      </button>
      {message && <p className="small muted">{message}</p>}
    </div>
  );
}

export function NewKey() {
  const router = useRouter();
  const [key, setKey] = useState<string>();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();
  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(undefined);
          try {
            const res = await send('/api/owner/keys', 'POST', { label: label || 'my agent' });
            setKey(res.key);
            setLabel('');
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. laptop agent" maxLength={60} style={{ flex: 1, minWidth: 180 }} />
        <button>New agent key</button>
      </form>
      {key && (
        <div>
          <p className="small">Copy it now; it won&apos;t be shown again:</p>
          <div className="secret">{key}</div>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export function RevokeKey({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button
      className="danger"
      onClick={async () => {
        if (!confirm('Revoke this key? Any agent using it stops working immediately.')) return;
        await send('/api/owner/keys', 'DELETE', { id }).catch((err) => alert((err as Error).message));
        router.refresh();
      }}
    >
      Revoke
    </button>
  );
}
