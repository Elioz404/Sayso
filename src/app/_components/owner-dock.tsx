'use client';

// The owner's assistant as a side panel on every page of the owner area (a sheet from the bottom on
// phones), like the buyers' "Ask AI to shop" but its own: it reads only this owner's shop. It lives in the
// owner layout, and the owner area moves between pages without reloading, so it stays open from page to
// page by itself. /owner?assistant=1 opens it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OWNER_CHAT_PREFIX, OwnerAssistant } from './owner-assistant.tsx';
import { useDockFocus } from './use-dock.ts';

export function OwnerDock({ chat, shopName }: { chat: string; shopName: string }) {
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState(0);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('assistant')) return;
    url.searchParams.delete('assistant');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    setOpen(true);
  }, []);

  useDockFocus(open, () => setOpen(false), { panel, focus: '#assistant-text', reopen: '.owner-fab' });

  // The page makes room in the same frame the panel starts to move (before paint).
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('owner-dock-open', open);
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
