'use client';

// Shop with AI as a side panel on the buyer's pages (the shops, a storefront, a product): the shop stays
// in view while the assistant builds the cart. Links to /assistant on these pages open the panel instead,
// with their written request ("Buy with AI"); everywhere else they go to the full page as before. The
// conversation is the same one the full page keeps in this browser.

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ShopperChat } from './shopper-chat.tsx';

/** Where the panel lives: where people look at what to buy. */
const BUYER_PAGES = /^\/(shops|shop\/)/;

export function ShopperDock({ paypalClientId }: { paypalClientId?: string }) {
  const path = usePathname();
  const here = BUYER_PAGES.test(path);
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ text: string; id: number }>();
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  // Catch clicks on links to the assistant (the menu, "Shop here with the assistant", "Buy with AI").
  useEffect(() => {
    if (!here) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a[href^="/assistant"]') as HTMLAnchorElement | null;
      if (!link || link.dataset.full) return;
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
    document.documentElement.classList.add('dock-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('dock-open');
      opener.current?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!here) return null;
  return (
    <>
      {!open && (
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
          <a href="/docs#chatgpt">Use your own assistant</a>
          <a href="/assistant" onClick={(e) => e.stopPropagation()} data-full="1">
            Open full page
          </a>
        </footer>
      </aside>
    </>
  );
}
