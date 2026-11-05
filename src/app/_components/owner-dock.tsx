'use client';

// The owner's assistant as a side panel on every page of the owner area (a sheet from the bottom on
// phones), like the buyers' "Ask AI to shop" but its own: it reads only this owner's shop. The rail's
// "Assistant" link opens it, and it stays open from page to page.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OWNER_CHAT_PREFIX, OwnerAssistant } from './owner-assistant.tsx';

const OPEN_KEY = 'sayso-owner-dock';

export function OwnerDock({ chat, shopName }: { chat: string; shopName: string }) {
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState(0);
  const panel = useRef<HTMLElement>(null);

  // Still open from the page before: shown at once, without sliding in again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('assistant')) {
      url.searchParams.delete('assistant');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      setOpen(true);
      return;
    }
    try {
      if (sessionStorage.getItem(OPEN_KEY)) {
        document.documentElement.classList.add('dock-instant');
        setOpen(true);
      }
    } catch {
      // storage off: starts closed
    }
  }, []);
  useEffect(() => {
    try {
      if (open) sessionStorage.setItem(OPEN_KEY, '1');
      else sessionStorage.removeItem(OPEN_KEY);
    } catch {
      // storage off: nothing to remember
    }
  }, [open]);

  // The rail's "Assistant" link (and any link to it) opens the panel instead of a page.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href="/owner/assistant"]');
      if (!link) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLInputElement>('#assistant-text')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('owner-dock-open', open);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('dock-instant')));
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open]);
  useEffect(() => () => document.documentElement.classList.remove('owner-dock-open'), []);

  return (
    <>
      {!open && (
        <button type="button" className="dock-fab owner-fab" onClick={() => setOpen(true)}>
          Ask about your shop
        </button>
      )}
      <div className={open ? 'dock-scrim dock-on' : 'dock-scrim'} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside ref={panel} className={open ? 'dock owner-dock dock-on' : 'dock owner-dock'} role="dialog" aria-modal="false" aria-label="Assistant" aria-hidden={!open} inert={!open}>
        <header className="dock-head">
          <span className="stack" style={{ gap: 0, minWidth: 0 }}>
            <b>Assistant</b>
            <span className="small muted">Reads {shopName}; changes nothing.</span>
          </span>
          <span className="dock-head-end">
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={() => {
                try {
                  sessionStorage.removeItem(`${OWNER_CHAT_PREFIX}${chat}`);
                } catch {
                  // storage off: nothing kept
                }
                setReset(Date.now());
              }}
            >
              New chat
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </span>
        </header>
        <div className="dock-body">
          <OwnerAssistant key={`${chat}:${reset}`} chat={chat} compact />
        </div>
      </aside>
    </>
  );
}
