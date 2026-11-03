'use client';

// Client islands for owner actions. Each calls an owner-only API route (signed session cookie) and
// refreshes the server-rendered page.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyField } from './client-ui.tsx';
import { Icon } from './ui.tsx';

async function send(url: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Something went wrong (${res.status})`);
  return data;
}

export function LoginForm({ demo }: { demo: boolean }) {
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
    <div className="stack-lg">
      <form
        className="panel panel-raised stack"
        style={{ gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void login({ shop: form.get('shop'), secret: form.get('secret') });
        }}
      >
        <div className="field">
          <label htmlFor="shop">Shop ID</label>
          <input id="shop" name="shop" placeholder="lumen-candles-807b" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="secret">Owner secret</label>
          <input id="secret" name="secret" type="password" placeholder="sk_owner_..." autoComplete="current-password" required />
          <span className="hint">You got it once, when the shop was created. Your agent&apos;s key won&apos;t work here, on purpose.</span>
        </div>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in'}
        </button>
        {error && <p className="error small">{error}</p>}
      </form>
      {demo && (
        <div className="panel panel-tight spread">
          <div className="stack" style={{ gap: 2 }}>
            <b>Just looking?</b>
            <span className="soft small">Open Maya Ceramics, the demo shop, as its owner.</span>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => void login({ demo: true })}>
            Open the demo shop
          </button>
        </div>
      )}
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="btn btn-quiet btn-small"
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
  const [busy, setBusy] = useState<'approve' | 'reject'>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState('');

  async function decide(decision: 'approve' | 'reject') {
    setBusy(decision);
    setError(undefined);
    try {
      await send(`/api/guard/${id}`, 'POST', { decision, note: note || undefined });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(undefined);
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {big && (
        <div className="field">
          <label htmlFor={`note-${id}`}>Note for the record (optional)</label>
          <input id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Saved in the audit log" maxLength={300} />
        </div>
      )}
      <div className="decide">
        <button className={`btn btn-primary${big ? ' btn-big' : ''}`} disabled={Boolean(busy)} onClick={() => void decide('approve')}>
          <Icon name="check" size={18} />
          {busy === 'approve' ? 'Approving...' : 'Say OK'}
        </button>
        <button className={`btn btn-danger${big ? ' btn-big' : ''}`} disabled={Boolean(busy)} onClick={() => void decide('reject')}>
          {busy === 'reject' ? 'Rejecting...' : 'Reject'}
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
    <div className="stack" style={{ gap: 8 }}>
      <button
        className="btn btn-primary"
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
        {busy ? 'Publishing...' : 'Publish shop'}
      </button>
      {message && <p className="small soft">{message}</p>}
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
        <label htmlFor="key-label" className="sr-only">Key label</label>
        <input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. laptop agent" maxLength={60} style={{ flex: 1, minWidth: 180 }} />
        <button className="btn">New agent key</button>
      </form>
      {key && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small soft">Copy it now. It won&apos;t be shown again.</span>
          <CopyField value={key} secret />
        </div>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export function RevokeKey({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  if (!confirming) {
    return (
      <button className="btn btn-quiet btn-small" onClick={() => setConfirming(true)}>
        Revoke
      </button>
    );
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="small soft">Revoke &ldquo;{label}&rdquo;?</span>
      <button
        className="btn btn-danger btn-small"
        onClick={async () => {
          try {
            await send('/api/owner/keys', 'DELETE', { id });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        Revoke now
      </button>
      <button className="btn btn-quiet btn-small" onClick={() => setConfirming(false)}>
        Keep
      </button>
      {error && <span className="error small">{error}</span>}
    </span>
  );
}
