'use client';

// Client islands for owner actions. Each calls an owner-only API route (signed session cookie) and
// refreshes the server-rendered page.

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ActionRules } from '@/core/guard/rules-by-action.ts';
import { callApi } from './api.ts';
import { CopyField } from './client-ui.tsx';
import { Modal } from './modal.tsx';
import { forgetOwnerChats } from './owner-assistant.tsx';
import { signChallenge, usePasskeyChallenge } from './passkey-client.ts';
import { RulesTable } from './rules-table.tsx';
import { Icon } from './ui.tsx';
import { useAction } from './use-action.ts';
import { ErrorText } from './error-text.tsx';

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
  // Signed out, however it happened: no owner conversation stays behind in this tab.
  useEffect(() => forgetOwnerChats(), []);
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
      <ErrorText>{error}</ErrorText>
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

export interface ShopChoice {
  slug: string;
  name: string;
  status: 'live' | 'draft';
  /** A photo from the shop, for telling shops apart at a glance. */
  image?: string;
  pieces: number;
}

function ShopAvatar({ shop }: { shop: ShopChoice }) {
  return (
    <span className="shop-avatar" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shop.image ? <img src={shop.image} alt="" /> : shop.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** For a seller signed in with PayPal who owns more than one shop: each shop with its photo, pieces and whether it's live. */
export function ShopSwitcher({ shops, current }: { shops: ShopChoice[]; current: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { busy, error, setError, run } = useAction();
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // The menu floats over the page, placed under the button, so it never makes the rail scroll.
  const [place, setPlace] = useState<{ top: number; left: number; width: number }>();
  useEffect(() => {
    if (!open) return;
    const rect = box.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 16);
      setPlace({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width });
    }
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const away = () => setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', away);
    document.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', away);
      document.removeEventListener('scroll', away, true);
    };
  }, [open]);
  const here = shops.find((s) => s.slug === current) ?? shops[0];
  return (
    <div className="shop-switch" ref={box}>
      <button
        ref={trigger}
        type="button"
        className="shop-switch-btn"
        aria-expanded={open}
        aria-controls="shop-list"
        onClick={() => {
          setError(undefined);
          setOpen(!open);
        }}
      >
        <ShopAvatar shop={here} />
        <b className="shop-switch-name">{here.name}</b>
        <svg className="shop-switch-chev" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        // A plain list of buttons (no menu role, so no menu keyboard contract to break): Tab moves through it.
        <div id="shop-list" className="shop-menu" aria-label="Your shops" style={place ? { position: 'fixed', top: place.top, left: place.left, width: place.width } : undefined}>
          {shops.map((s) => (
            <button
              key={s.slug}
              type="button"
              aria-current={s.slug === current ? 'true' : undefined}
              className="shop-menu-item"
              disabled={Boolean(busy)}
              onClick={() => {
                if (s.slug === current) return setOpen(false);
                void run(async () => {
                  await callApi('/api/owner/session', 'POST', { shop: s.slug, paypal: true });
                  setOpen(false);
                  router.refresh();
                }, s.slug);
              }}
            >
              <ShopAvatar shop={s} />
              <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                <b>{s.name}</b>
                <span className="small soft">
                  {busy === s.slug ? 'Opening…' : `${s.pieces} piece${s.pieces === 1 ? '' : 's'} · ${s.status === 'live' ? 'Live' : 'Draft'}`}
                </span>
              </span>
              {s.slug === current && <Icon name="check" size={16} />}
            </button>
          ))}
          <ErrorText>{error}</ErrorText>
          <a className="shop-menu-item shop-menu-new" href="/start">
            <span className="shop-avatar" aria-hidden="true">
              <Icon name="plus" size={16} />
            </span>
            <b>Open another shop</b>
          </a>
        </div>
      )}
    </div>
  );
}

/** A notice that came with the address (?published=1, ?payouts=...): shown once, then the address forgets it. */
export function FlashNotice({ params, className, children }: { params: string[]; className?: string; children: React.ReactNode }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!params.some((p) => url.searchParams.has(p))) return;
    params.forEach((p) => url.searchParams.delete(p));
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    // Only the first render's address matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!shown) return null;
  return (
    <div className={`flash ${className ?? ''}`} role="status">
      <span>{children}</span>
      <button type="button" className="flash-x" aria-label="Dismiss" onClick={() => setShown(false)}>
        <Icon name="x" size={14} />
      </button>
    </div>
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
            forgetOwnerChats();
            window.location.assign('/owner');
          })
        }
      >
        {busy ? 'Signing out...' : 'Sign out on every device'}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function SignOut() {
  const router = useRouter();
  const { busy, error, run } = useAction();
  return (
    <>
      <button
        className="btn btn-quiet btn-small"
        disabled={Boolean(busy)}
        onClick={() =>
          run(async () => {
            await callApi('/api/owner/session', 'DELETE');
            forgetOwnerChats();
            router.refresh();
          })
        }
      >
        <Icon name="out" size={16} /> Sign out
      </button>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

/** `passkey`: the shop approves with a passkey, so "Say OK" opens the fingerprint/face prompt first. */
/** `onDone`: after the answer is saved (the page around it refreshes either way). */
export function Decision({ id, big = false, passkey = false, onDone }: { id: string; big?: boolean; passkey?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  // A list can hold many of these: each fetches its passkey challenge only once its button is on screen,
  // hovered or focused, which still lands before the tap that needs it.
  const approve = useRef<HTMLButtonElement>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = approve.current;
    if (!passkey || armed || !el) return;
    const seen = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setArmed(true));
    seen.observe(el);
    return () => seen.disconnect();
  }, [passkey, armed]);
  const signing = usePasskeyChallenge(passkey && armed ? { purpose: 'approve', record: id } : undefined);

  const decide = (decision: 'approve' | 'reject') =>
    run(async () => {
      try {
        let proof;
        if (decision === 'approve' && passkey) {
          if (!signing.challenge) throw new Error(signing.error ?? 'Getting the passkey ready, try again in a second');
          proof = await signChallenge(signing.challenge);
        }
        await callApi(`/api/guard/${id}`, 'POST', { decision, note: note || undefined, passkey: proof });
        onDone?.();
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
        <button
          ref={approve}
          className={`btn btn-primary${big ? ' btn-big' : ''}`}
          disabled={Boolean(busy)}
          onPointerEnter={() => setArmed(true)}
          onFocus={() => setArmed(true)}
          onClick={() => void decide('approve')}
        >
          <Icon name={passkey ? 'fingerprint' : 'check'} size={18} />
          {busy === 'approve' ? (passkey ? 'Waiting for your passkey...' : 'Approving...') : 'Say OK'}
        </button>
        <button className={`btn btn-danger${big ? ' btn-big' : ''}`} disabled={Boolean(busy)} onClick={() => void decide('reject')}>
          {busy === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
      {passkey && big && <p className="small muted">Confirm with your fingerprint, face or PIN. Your device signs this exact request.</p>}
      <ErrorText>{error}</ErrorText>
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
interface IssuedKey {
  label: string;
  key: string;
  mcp_url: string;
  cli_login: string;
}

type AppChoice = 'chatgpt' | 'claude';

/** Where each app adds a connector by URL; it then signs in with Sayso (OAuth) and gets its own key. */
const APPS: Record<AppChoice, { name: string; open: string; where: string }> = {
  chatgpt: {
    name: 'ChatGPT',
    open: 'https://chatgpt.com/',
    where: 'In ChatGPT, open Plugins (Settings, then Apps, on some plans) and add a custom MCP server. Paste the address and pick OAuth.',
  },
  claude: {
    name: 'Claude',
    open: 'https://claude.ai/customize/connectors',
    where: 'In Claude, open Customize, then Connectors, and choose Add custom connector. Paste the address and click Add.',
  },
};

/**
 * "Connect an agent", in a modal. ChatGPT or Claude: paste one public address in the app, which then sends
 * the owner here to allow it and gets a key of its own (no secret to copy). Anything else: name it and copy
 * its key once, as the personal URL an MCP app takes, a terminal login, or a bearer header (`endpoint`).
 */
export function ConnectAgent({ endpoint, quiet = false, passkey = false }: { endpoint: string; quiet?: boolean; passkey?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'choose' | AppChoice | 'other'>('choose');
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<IssuedKey>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const close = () => {
    setOpen(false);
    router.refresh(); // an app allowed meanwhile (in another tab) shows in the list
  };
  const app = step === 'chatgpt' || step === 'claude' ? APPS[step] : undefined;
  // A new key is a new credential: confirmed with the passkey once the shop has one.
  const confirm = usePasskeyChallenge(passkey && step === 'other' && !issued ? { purpose: 'confirm', what: 'agent-key' } : undefined);

  return (
    <>
      <button
        type="button"
        className={`btn${quiet ? '' : ' btn-primary'}`}
        onClick={() => {
          setStep('choose');
          setIssued(undefined);
          setName('');
          setError(undefined);
          setOpen(true);
        }}
      >
        Connect an agent
      </button>
      {/* Escape and the backdrop don't close it while a key is on screen: it is shown only once. */}
      <Modal open={open} onClose={close} dismissible={!issued} labelledBy="connect-title">
        {step === 'choose' ? (
          <div className="connect">
            <div className="stack" style={{ gap: 4 }}>
              <h2 id="connect-title" className="h3">
                Connect an agent
              </h2>
              <p className="small soft">Each agent gets its own key, so you see what it did and can cut it off alone.</p>
            </div>
            <div className="connect-choices">
              {(Object.keys(APPS) as AppChoice[]).map((id) => (
                <button key={id} type="button" className="connect-choice" onClick={() => setStep(id)}>
                  <b>{APPS[id].name}</b>
                  <span className="small soft">Signs in with Sayso. No key to copy.</span>
                </button>
              ))}
              <button type="button" className="connect-choice" onClick={() => setStep('other')}>
                <b>Another app or a terminal</b>
                <span className="small soft">Any MCP app, a script or the Sayso CLI, with a key you copy.</span>
              </button>
            </div>
          </div>
        ) : app ? (
          <div className="connect">
            <div className="stack" style={{ gap: 4 }}>
              <h2 id="connect-title" className="h3">
                Connect {app.name}
              </h2>
              <p className="small soft">{app.name} needs a plan that allows custom connectors.</p>
            </div>
            <ol className="connect-steps">
              <li>
                <b>Copy this address</b>
                <CopyField value={endpoint} />
              </li>
              <li>
                <b>Add it in {app.name}</b>
                <span className="small soft">{app.where}</span>
                <a className="btn btn-small connect-open" href={app.open} target="_blank" rel="noopener noreferrer">
                  Open {app.name} ↗
                </a>
              </li>
              <li>
                <b>Allow it here</b>
                <span className="small soft">{app.name} sends you to Sayso to say yes. It then shows under Connected agents.</span>
              </li>
            </ol>
            <div className="connect-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setStep('choose')}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        ) : issued ? (
          <div className="connect">
            <div className="stack" style={{ gap: 4 }}>
              <h2 id="connect-title" className="h3">
                {issued.label} has its key
              </h2>
              <p className="small soft">Copy it now. Sayso shows it only once.</p>
            </div>
            <ol className="connect-steps">
              <li>
                <b>In an MCP app</b>
                <span className="small soft">Add a custom connector and paste this URL.</span>
                <CopyField value={issued.mcp_url} secret />
              </li>
              <li>
                <b>Or in a terminal</b>
                <CopyField value={issued.cli_login} secret />
              </li>
            </ol>
            <details className="connect-more">
              <summary className="small">Clients that send headers</summary>
              <div className="stack" style={{ gap: 'var(--s2)' }}>
                <CopyField value={endpoint} />
                <CopyField value={`Authorization: Bearer ${issued.key}`} secret />
              </div>
            </details>
            <p className="small muted">It works like a password. If it leaks, revoke it here.</p>
            <button type="button" className="btn btn-primary" onClick={close}>
              Done
            </button>
          </div>
        ) : (
          <form
            className="connect"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              try {
                let proof;
                if (passkey) {
                  if (!confirm.challenge) throw new Error(confirm.error ?? 'Getting the passkey ready, try again in a second');
                  proof = await signChallenge(confirm.challenge);
                }
                setIssued(await callApi<IssuedKey>('/api/owner/keys', 'POST', { label: name.trim() || 'My agent', proof }));
                // The list refreshes when this closes: refreshing now could swap the page under the key, shown only once.
              } catch (err) {
                setError((err as Error).message);
              }
              setBusy(false);
            }}
          >
            <div className="stack" style={{ gap: 4 }}>
              <h2 id="connect-title" className="h3">
                Another app or a terminal
              </h2>
              <p className="small soft">Name it so you can tell it apart later.</p>
            </div>
            <div className="field">
              <label htmlFor="agent-name">Name</label>
              <input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My laptop, a script…" maxLength={60} autoComplete="off" />
            </div>
            <ErrorText>{error}</ErrorText>
            <div className="connect-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setStep('choose')}>
                Back
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating the key…' : 'Create key'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
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
      <ErrorText inline>{error}</ErrorText>
    </span>
  );
}

interface RulesDraft {
  token: string;
  version: string;
  rows: ActionRules[];
  unclear: string[];
}

/**
 * The owner changes the rules in their own words: Sayso drafts them, shows them per action, and nothing
 * changes until the owner saves (with their passkey, once the shop has one).
 */
export function RulesEditor({ passkey = false, example }: { passkey?: boolean; example: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<RulesDraft>();
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  const confirm = usePasskeyChallenge(passkey && draft ? { purpose: 'confirm', what: `rules:${draft.version}` } : undefined);

  if (draft) {
    return (
      <div className="stack rules-draft" style={{ gap: 'var(--s4)' }}>
        <div className="stack" style={{ gap: 4 }}>
          <b>Your new rules</b>
          <span className="small soft">&ldquo;{text.trim()}&rdquo;</span>
        </div>
        <RulesTable rows={draft.rows} label="Your new rules, per action" />
        {draft.unclear.length > 0 && (
          <div className="small">
            <b>Not turned into a rule</b>
            <ul className="rules-unclear">
              {draft.unclear.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="small soft">These replace your current rules.</p>
        <div className="connect-actions">
          <button type="button" className="btn btn-quiet" disabled={Boolean(busy)} onClick={() => setDraft(undefined)}>
            Edit
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(async () => {
                let proof;
                if (passkey) {
                  if (!confirm.challenge) throw new Error(confirm.error ?? 'Getting the passkey ready, try again in a second');
                  proof = await signChallenge(confirm.challenge);
                }
                await callApi('/api/owner/rules', 'POST', { token: draft.token, passkey: proof });
                setDraft(undefined);
                setText('');
                setSaved(true);
                router.refresh();
              }, 'save')
            }
          >
            {busy === 'save' ? (passkey ? 'Waiting for your passkey…' : 'Saving…') : 'Save these rules'}
          </button>
        </div>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  }

  return (
    <form
      className="stack"
      style={{ gap: 'var(--s3)' }}
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run(async () => setDraft(await callApi<RulesDraft>('/api/owner/rules/draft', 'POST', { text })), 'draft');
      }}
    >
      <div className="field">
        <label htmlFor="rules-text">Write your rules</label>
        <textarea id="rules-text" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={example} />
      </div>
      <div className="connect-actions">
        {!text && (
          <button type="button" className="btn btn-quiet" onClick={() => setText(example)}>
            Use the example
          </button>
        )}
        <button className="btn btn-primary" disabled={Boolean(busy) || text.trim().length < 3}>
          {busy === 'draft' ? 'Drafting…' : 'Draft rules'}
        </button>
      </div>
      {saved && <p className="small ok-text">Saved. Your agents follow the new rules from now on.</p>}
      <ErrorText>{error}</ErrorText>
    </form>
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
      <ErrorText>{error}</ErrorText>
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
        {busy ? 'Opening PayPal...' : again ? 'Connect a different account' : 'Set up payments'}
      </button>
      <ErrorText>{error}</ErrorText>
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
      <ErrorText inline>{error}</ErrorText>
    </span>
  );
}
