'use client';

// What both side panels (the buyers' "Ask AI to shop" and the owner's assistant) do the same way while
// open: focus goes into the panel, Escape closes it (unless something on top of it, a modal, took the
// Escape), and focus goes back to what opened it, or to the button that opens it again.

import { useEffect, type RefObject } from 'react';

export function useDockFocus(
  open: boolean,
  close: () => void,
  options: { panel: RefObject<HTMLElement | null>; focus?: string; reopen: string; opener?: RefObject<HTMLElement | null> },
): void {
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const from = options.opener?.current ?? active;
    if (options.focus) options.panel.current?.querySelector<HTMLElement>(options.focus)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // After the panel has gone (and the button that opens it is back).
      requestAnimationFrame(() => {
        const target = from?.isConnected && !options.panel.current?.contains(from) ? from : document.querySelector<HTMLElement>(options.reopen);
        target?.focus({ preventScroll: true });
      });
    };
    // Runs when the panel opens or closes, not when its options change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
