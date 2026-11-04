'use client';

// Client islands for owner actions. Each calls an owner-only API route (signed session cookie) and
// refreshes the server-rendered page.

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api.ts';
import { CopyField } from './client-ui.tsx';
import { signChallenge, usePasskeyChallenge } from './passkey-client.ts';
import { Icon } from './ui.tsx';
import { useAction } from './use-action.ts';

/** What PayPal sign-in came back with, as /owner?signin=... */
const SIGN_IN_OUTCOMES: Record<string, string> = {
  cancelled: 'You left PayPal before signing in. Nothing changed.',
  expired: 'That sign-in took too long or came from another browser. Please try again.',
  'no-shop': 'You signed in with PayPal, but no shop belongs to that account yet. Create one first.',
  taken: 'That shop already belongs to another PayPal account.',
  failed: 'PayPal sign-in did not go through. Please try again.',
};

/** `next`: where to land after signing in with PayPal (this page by default lands on /owner). */
export function LoginForm({ demo, paypal, next }: { demo: boolean; paypal: boolean; next?: string }) {
  const router = useRouter();
  const outcome = useSearchParams().get('signin') ?? undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function login(body: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      await callApi('/api/owner/session', 'POST', body);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const secretForm = (
    <form
      className="stack"
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
      <button className={paypal ? 'btn' : 'btn btn-primary'} disabled={busy}>
        {busy ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );

  return (
    <div className="stack" style={{ gap: 'var(--s4)' }}>
      {outcome && SIGN_IN_OUTCOMES[outcome] && <div className="callout small">{SIGN_IN_OUTCOMES[outcome]}</div>}
      {paypal ? (
        <div className="panel panel-raised stack" style={{ gap: 16 }}>
          <a className="btn btn-paypal" href={`/api/owner/paypal/start${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
            Sign in with PayPal
          </a>
          <p className="small soft">Use the PayPal account your shop is paid into. There is no Sayso password to remember or lose.</p>
          <details className="quiet-details">
            <summary className="small">Have an owner secret instead?</summary>
            {secretForm}
          </details>
        </div>
      ) : (
        <div className="panel panel-raised">{secretForm}</div>
      )}
      {error && <p className="error small">{error}</p>}
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

/** For a seller signed in with PayPal who owns more than one shop. */
export function ShopSwitcher({ shops, current }: { shops: { slug: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <label className="field shop-switch">
      <span className="sr-only">Switch shop</span>
      <select
        value={current}
        onChange={async (e) => {
          await callApi('/api/owner/session', 'POST', { shop: e.target.value, paypal: true }).catch(() => {});
          router.refresh();
        }}
      >
        {shops.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Ends every session of the shop, on every device (this one too). */
export function SignOutEverywhere() {
  const { busy, error, run } = useAction();
  return (
    <div className="stack" style={{ gap: 6, alignItems: 'flex-start' }}>
      <button
        className="btn btn-danger btn-small"
        disabled={Boolean(busy)}
        onClick={() =>
          void run(async () => {
            await callApi('/api/owner/session', 'DELETE', { everywhere: true });
            window.location.assign('/owner');
          })
        }
      >
        {busy ? 'Signing out...' : 'Sign out on every device'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="btn btn-quiet btn-small"
      onClick={async () => {
        await callApi('/api/owner/session', 'DELETE').catch(() => {});
        router.refresh();
      }}
    >
      <Icon name="out" size={16} /> Sign out
    </button>
  );
}

/** `passkey`: the shop approves with a passkey, so "Say OK" opens the fingerprint/face prompt first. */
export function Decision({ id, big = false, passkey = false }: { id: string; big?: boolean; passkey?: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  const signing = usePasskeyChallenge(passkey ? { purpose: 'approve', record: id } : undefined);

  const decide = (decision: 'approve' | 'reject') =>
    run(async () => {
      try {
        let proof;
        if (decision === 'approve' && passkey) {
          if (!signing.challenge) throw new Error(signing.error ?? 'Getting the passkey ready, try again in a second');
          proof = await signChallenge(signing.challenge);
        }
        await callApi(`/api/guard/${id}`, 'POST', { decision, note: note || undefined, passkey: proof });
        router.refresh();
      } catch (err) {
        if (passkey) void signing.reload(); // each challenge works once
        throw err;
      }
    }, decision);

  return (
    <div className="stack" style={{ gap: 10 }}>
      {big && (
        <div className="field">
          <label htmlFor={`note-${id}`}>Note for the record (optional)</label>
          <input id={`note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Saved in the audit log" maxLength={300} />
        </div>
      )}
      <div className={`decide${big ? ' decide-big' : ''}`}>
        <button className={`btn btn-primary${big ? ' btn-big' : ''}`} disabled={Boolean(busy)} onClick={() => void decide('approve')}>
          <Icon name={passkey ? 'fingerprint' : 'check'} size={18} />
          {busy === 'approve' ? (passkey ? 'Waiting for your passkey...' : 'Approving...') : 'Say OK'}
        </button>
        <button className={`btn btn-danger${big ? ' btn-big' : ''}`} disabled={Boolean(busy)} onClick={() => void decide('reject')}>
          {busy === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
      {passkey && big && <p className="small muted">Confirm with your fingerprint, face or PIN. Your device signs this exact request.</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** The shop's name under the Overview title, with a way to change it (not in the shared demo). */
export function ShopName({ name, readOnly = false }: { name: string; readOnly?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!editing) {
    return (
      <p className="sub row" style={{ gap: 'var(--s2)' }}>
        <span>{name}</span>
        {!readOnly && (
          <button type="button" className="link-button small" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
      </p>
    );
  }
  return (
    <form
      className="row shop-rename"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await callApi('/api/owner/shop', 'POST', { name: value });
          setEditing(false);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} minLength={2} maxLength={60} aria-label="Shop name" autoFocus disabled={busy} />
      <button className="btn btn-primary btn-small" disabled={busy || value.trim().length < 2}>
        {busy ? 'Saving...' : 'Save'}
      </button>
      <button type="button" className="btn btn-quiet btn-small" onClick={() => { setEditing(false); setValue(name); }} disabled={busy}>
        Cancel
      </button>
      {error && <span className="small error">{error}</span>}
    </form>
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
            const res = await callApi<{ warnings: string[] }>('/api/owner/publish', 'POST');
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

/** Issues an agent key and shows it as a personal MCP URL (what assistant connector screens take). */
export function NewKey() {
  const router = useRouter();
  const [issued, setIssued] = useState<{ mcp_url: string; cli_login: string }>();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="stack">
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            setIssued(await callApi<{ mcp_url: string; cli_login: string }>('/api/owner/keys', 'POST', { label: label || 'my agent' }));
            setLabel('');
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        <label htmlFor="key-label" className="sr-only">Key label</label>
        <input id="key-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Which agent? e.g. ChatGPT, my laptop" maxLength={60} style={{ flex: 1, minWidth: 180 }} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Connecting...' : 'Connect an agent'}
        </button>
      </form>
      {issued && (
        <div className="stack" style={{ gap: 'var(--s3)' }}>
          <div className="field">
            <span className="field-label">Personal MCP URL: paste it as a connector in ChatGPT or any MCP client</span>
            <CopyField value={issued.mcp_url} secret />
          </div>
          <div className="field">
            <span className="field-label">Or from a terminal</span>
            <CopyField value={issued.cli_login} secret />
          </div>
          <span className="small soft">Shown only now. Treat it like a password; revoke it here if it leaks.</span>
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
            await callApi('/api/owner/keys', 'DELETE', { id });
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

/** Adopt a rule the owner's approvals earned; confirmed with their passkey once the shop has one. */
export function AdoptRule({ id, passkey = false }: { id: string; passkey?: boolean }) {
  const router = useRouter();
  const { busy, error, run } = useAction();
  const confirm = usePasskeyChallenge(passkey ? { purpose: 'confirm', what: `adopt-rule:${id}` } : undefined);
  const adopt = () =>
    run(async () => {
      let proof;
      if (passkey) {
        if (!confirm.challenge) throw new Error(confirm.error ?? 'Getting the passkey ready, try again in a second');
        proof = await signChallenge(confirm.challenge);
      }
      await callApi(`/api/owner/rules/suggestions/${id}`, 'POST', { passkey: proof });
      router.refresh();
    });
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void adopt()}>
        {passkey && <Icon name="fingerprint" size={18} />}
        {busy ? 'Saving...' : 'Use this rule'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** Sends the owner to PayPal to connect the account their sales are paid into. */
export function ConnectPayouts({ again = false }: { again?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        className={again ? 'btn btn-small' : 'btn btn-paypal'}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            window.location.assign((await callApi<{ url: string }>('/api/owner/payouts', 'POST')).url);
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Opening PayPal...' : again ? 'Connect a different account' : 'Connect your PayPal'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** Keeps a price Sayso suggested for a draft (saving it is the owner's confirmation). */
export function KeepPrice({ variantId, price, label }: { variantId: string; price: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <span className="stack" style={{ gap: 4 }}>
      <button
        className="btn btn-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await callApi(`/api/owner/variants/${encodeURIComponent(variantId)}`, 'PATCH', { price });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? 'Saving...' : label}
      </button>
      {error && <span className="error small">{error}</span>}
    </span>
  );
}
