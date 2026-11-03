'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui.tsx';

export function NavLinks({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const links = [
    { href: '/start', label: 'Start selling' },
    { href: '/shop/maya-ceramics', label: 'Demo shop' },
    { href: '/docs', label: 'Docs' },
  ];
  return (
    <nav className="nav" aria-label="Main">
      {links.map((l) => (
        <a key={l.href} href={l.href} className="nav-link" aria-current={path.startsWith(l.href) ? 'page' : undefined}>
          {l.label}
        </a>
      ))}
      <a href="/owner" className="btn btn-small" aria-current={path.startsWith('/owner') ? 'page' : undefined}>
        {signedIn ? 'Your shop' : 'Owner sign-in'}
      </a>
    </nav>
  );
}

export interface RailItem {
  href: string;
  label: string;
  icon: string;
  count?: number;
}

/** The owner area's navigation; marks the current view. */
export function RailNav({ items }: { items: RailItem[] }) {
  const path = usePathname();
  return (
    <nav className="rail-nav" aria-label="Shop">
      {items.map((item) => {
        const current = item.href === '/owner' ? path === '/owner' : path.startsWith(item.href);
        return (
          <a key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
            <Icon name={item.icon} size={18} />
            {item.label}
            {item.count ? (
              <span className="count-badge" aria-label={`${item.count} waiting`}>
                {item.count}
              </span>
            ) : null}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * The owner rail. On wide screens it is a fixed side column; on phones it collapses to a top bar
 * with a menu button that slides the same rail in from the left.
 */
export function RailDrawer({ brand, waiting, children }: { brand: ReactNode; waiting: number; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 960px)');
    const update = () => {
      setPhone(query.matches);
      if (!query.matches) setOpen(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Close on navigation.
  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    // Behind the open menu, the page can't be scrolled or tabbed into.
    const page = document.querySelector<HTMLElement>('.owner-main');
    document.addEventListener('keydown', close);
    document.documentElement.style.overflow = 'hidden';
    if (page) page.inert = true;
    drawer.current?.querySelector<HTMLElement>('[aria-current="page"], .rail-nav a')?.focus();
    return () => {
      document.removeEventListener('keydown', close);
      document.documentElement.style.overflow = '';
      if (page) page.inert = false;
    };
  }, [open]);

  return (
    <div className={`rail-inner${open ? ' is-open' : ''}`}>
      <div className="rail-top">
        {brand}
        <button
          ref={button}
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="rail-drawer"
          aria-label={waiting ? `Menu, ${waiting} waiting for your OK` : 'Menu'}
          onClick={() => setOpen(true)}
        >
          <Icon name="menu" size={22} />
          {waiting > 0 && <span className="menu-dot" aria-hidden="true" />}
        </button>
      </div>
      <div
        id="rail-drawer"
        ref={drawer}
        className="rail-drawer"
        role={phone ? 'dialog' : undefined}
        aria-modal={phone && open ? true : undefined}
        aria-label={phone ? 'Menu' : undefined}
        inert={phone && !open ? true : undefined}
      >
        <div className="rail-drawer-head">
          {brand}
          <button
            type="button"
            className="menu-button"
            aria-label="Close menu"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
            }}
          >
            <Icon name="x" size={22} />
          </button>
        </div>
        {children}
      </div>
      <div className="rail-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
    </div>
  );
}

/** Copies text; falls back to selecting it when the clipboard is unavailable. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');
  return (
    <button
      type="button"
      className="btn btn-quiet btn-small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState('copied');
        } catch {
          setState('select');
        }
        setTimeout(() => setState('idle'), 1800);
      }}
    >
      <Icon name={state === 'copied' ? 'check' : 'copy'} size={15} />
      {state === 'copied' ? 'Copied' : state === 'select' ? 'Select and copy' : label}
    </button>
  );
}

/** A secret or command shown with its copy button. */
export function CopyField({ value, secret = false }: { value: string; secret?: boolean }) {
  return (
    <div className={`copy-field${secret ? ' copy-field-secret' : ''}`}>
      <code>{value}</code>
      <CopyButton text={value} />
    </div>
  );
}
