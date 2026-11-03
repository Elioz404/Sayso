'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Icon } from './ui.tsx';

export function NavLinks({ signedIn }: { signedIn: boolean }) {
  const path = usePathname();
  const links = [
    { href: '/start', label: 'Start selling' },
    { href: '/shop/maya-ceramics', label: 'Demo shop' },
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
