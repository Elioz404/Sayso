'use client';

// Buttons of For Judges: run one of the agents' steps on the judge's shop, open a page in a new tab and
// count that step as seen, open the demo shop's dashboard, switch back to the judge's own shop, and keep
// the checklist current when the judge comes back to it or pays in the panel.

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { callApi } from './api.ts';
import { markSeen } from './judges-seen.ts';


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

/** A link that opens in a new tab and ticks its step off here. */
export function SeenLink({ href, seen, className, children }: { href: string; seen: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener"
      onClick={() => {
        markSeen(seen);
        router.refresh();
      }}
    >
      {children}
    </a>
  );
}

/** The demo shop's dashboard (a shared, read-mostly session) in a new tab, on its overview. */
export function OpenDemoShop() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="stack" style={{ gap: 'var(--s2)', alignItems: 'flex-start' }}>
      <button
        className="btn btn-small"
        disabled={busy}
        onClick={async () => {
          // The tab opens with the click (so it isn't blocked), and goes to the dashboard once signed in.
          const tab = window.open('about:blank', '_blank');
          setBusy(true);
          try {
            await callApi('/api/owner/session', 'POST', { demo: true });
            markSeen('shop');
            if (tab) tab.location.href = '/owner';
            else window.location.href = '/owner';
            router.refresh();
          } catch (err) {
            tab?.close();
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? 'Opening…' : "Open the shop's dashboard ↗"}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/** Back to the judge's own shop (they signed in with PayPal), after looking at another shop's dashboard. */
export function SwitchToShop({ slug }: { slug: string }) {
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
          try {
            await callApi('/api/owner/session', 'POST', { shop: slug, paypal: true });
            router.refresh();
          } catch (err) {
            setError((err as Error).message);
          }
          setBusy(false);
        }}
      >
        {busy ? 'Switching…' : 'Switch back to your shop'}
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

/**
 * Keeps the checklist current: when the judge comes back to this tab (from their order, the dashboard,
 * PayPal), and when something changes in the shopping panel on this page (a payment, a refund request).
 */
export function JudgesRefresh() {
  const router = useRouter();
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && router.refresh();
    const changed = () => router.refresh();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('sayso:changed', changed);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('sayso:changed', changed);
    };
  }, [router]);
  return null;
}

/** What this browser keeps for the shopping panel: the conversation, the cart, its receipts. */
const KEPT = ['sayso-shopper-v1', 'sayso-receipts-v1', 'sayso-cart-v1'];

/** For Judges from the start, in this browser, after a second "yes". */
export function ResetJudges() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!asking) {
    return (
      <button type="button" className="btn btn-quiet btn-small" onClick={() => setAsking(true)}>
        Start over
      </button>
    );
  }
  return (
    <span className="judges-reset">
      <span className="small">Clear your progress, the chat and the cart, and sign out here?</span>
      <button
        type="button"
        className="btn btn-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await callApi('/api/tour/reset', 'POST');
            try {
              KEPT.forEach((key) => localStorage.removeItem(key));
              sessionStorage.clear();
            } catch {
              // storage off: nothing kept here anyway
            }
            window.location.href = '/tour';
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? 'Clearing…' : 'Yes, start over'}
      </button>
      <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </button>
      {error && <span className="small error">{error}</span>}
    </span>
  );
}
