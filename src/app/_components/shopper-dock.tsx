'use client';

// Shop with AI: a side panel on every public page (a sheet from the bottom on phones), so whatever page
// someone is on stays in view while the assistant searches every shop and builds the cart. Links to
// /assistant open it (with their written request, as "Buy with AI" does), and so does ?assistant=1 or
// ?ask=... in the address. It stays open while the person moves between shops and products, and the
// conversation is kept in this browser.

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DOCK_OPEN_KEY as OPEN_KEY, NOT_HERE } from './dock-restore.ts';
import { ShopperChat } from './shopper-chat.tsx';

/** The floating button is the way in; not on the seller's onboarding, which is about something else. */
const NO_BUTTON = /^\/start/;

export function ShopperDock({ paypalClientId }: { paypalClientId?: string }) {
  const path = usePathname();
  const here = !NOT_HERE.test(path);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ text: string; id: number }>();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Opened by the address (?assistant=1, ?ask=...), or still open from the page before.
  useEffect(() => {
    if (!here) return;
    const url = new URL(window.location.href);
    const ask = url.searchParams.get('ask');
    if (ask || url.searchParams.has('assistant')) {
      url.searchParams.delete('ask');
      url.searchParams.delete('assistant');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      if (ask) setRequest({ text: ask.slice(0, 300), id: Date.now() });
      setOpen(true);
      return;
    }
    try {
      if (sessionStorage.getItem(OPEN_KEY) || document.documentElement.classList.contains('dock-open')) setOpen(true);
    } catch {
      // storage off: starts closed
    }
  }, [here]);
  useEffect(() => {
    try {
      if (open) sessionStorage.setItem(OPEN_KEY, '1');
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // storage off: nothing to remember
    }
  }, [open]);

  // Catch clicks on links to the assistant (the menu, "Shop here with the assistant", "Buy with AI").
  useEffect(() => {
    if (!here) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href^="/assistant"]') as HTMLAnchorElement | null;
      if (!link) return;
      e.preventDefault();
      opener.current = link;
      const ask = new URL(link.href).searchParams.get('ask');
      if (ask) setRequest({ text: ask, id: Date.now() });
      setOpen(true);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [here]);

  // Esc closes; focus goes to the message box on opening and back to what opened it on closing.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('.shopper-input')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener.current?.focus({ preventScroll: true });
    };
  }, [open]);

  // The page makes room in the same frame the panel starts to move (before paint), never a frame later.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dock-open', open && here);
    if (!root.classList.contains('dock-instant')) return;
    // Restored before paint: let the next open or close animate again.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('dock-instant')));
    return () => cancelAnimationFrame(frame);
  }, [open, here]);

  if (!here) return null;
  return (
    <>
      {!open && !NO_BUTTON.test(path) && (
        <button type="button" className="dock-fab" onClick={() => setOpen(true)}>
          <span aria-hidden="true">✦</span> Ask AI to shop
        </button>
      )}
      <div className={open ? 'dock-scrim dock-on' : 'dock-scrim'} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside ref={panel} className={open ? 'dock dock-on' : 'dock'} role="dialog" aria-modal="false" aria-label="Shop with AI" aria-hidden={!open} inert={!open}>
        <header className="dock-head">
          <div className="stack" style={{ gap: 0, minWidth: 0 }}>
            <b>Shop with AI</b>
            <span className="small muted">Searches every Sayso shop · pay with PayPal</span>
          </div>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpen(false)} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="dock-body">
          <ShopperChat paypalClientId={paypalClientId} request={request} compact />
        </div>
        <footer className="dock-foot small">
          <span className="muted">Only shopping at Sayso shops.</span>
          <a href="/docs#chatgpt">Use your own assistant</a>
        </footer>
      </aside>
    </>
  );
}
