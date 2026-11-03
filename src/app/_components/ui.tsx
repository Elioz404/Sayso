// Shared presentational pieces: the mark, a small icon set, status pills and who-did-it chips.
// Server-safe (no hooks); interactive pieces live in the client files.

import type { ReactNode } from 'react';

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" className="mark-bg" />
      <path d="M22 13h20a7 7 0 0 1 7 7v15a7 7 0 0 1-7 7H31l-9 8v-8a7 7 0 0 1-7-7V20a7 7 0 0 1 7-7z" className="mark-bubble" />
      <path d="M24.5 28.5l5.5 5.5 10.5-11" className="mark-check" />
    </svg>
  );
}

const PATHS: Record<string, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  agent: (
    <>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <path d="M12 3v4M9 12h.01M15 12h.01M9.5 16h5" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  bag: (
    <>
      <path d="M5 8h14l-1 12H6L5 8z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3M12 15h5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />,
  home: <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  box: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4V8z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  external: <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  out: <path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H9" />,
  chain: (
    <>
      <rect x="3" y="9" width="8" height="6" rx="3" />
      <rect x="13" y="9" width="8" height="6" rx="3" />
      <path d="M10 12h4" />
    </>
  ),
};

export function Icon({ name, size = 18, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Waiting for you',
  verified: 'Done',
  executed: 'Sent',
  denied: 'Blocked',
  rejected: 'Rejected',
  failed: 'Failed',
  executing: 'Running',
  paid: 'Paid',
  awaiting_owner: 'Waiting for you',
  awaiting_buyer: 'Awaiting buyer',
  needs_info: 'Needs info',
  released: 'Released',
  live: 'Live',
  draft: 'Draft',
};

const STATUS_TONE: Record<string, 'ok' | 'hold' | 'stop' | 'quiet'> = {
  verified: 'ok',
  executed: 'ok',
  paid: 'ok',
  live: 'ok',
  pending_approval: 'hold',
  awaiting_owner: 'hold',
  draft: 'hold',
  denied: 'stop',
  rejected: 'stop',
  failed: 'stop',
  released: 'stop',
};

export function Status({ value }: { value: string }) {
  return <span className={`status status-${STATUS_TONE[value] ?? 'quiet'}`}>{STATUS_LABEL[value] ?? value.replace(/_/g, ' ')}</span>;
}

/** Who asked: agents and people are told apart everywhere money is involved. */
export function Who({ actor }: { actor: { type: 'agent' | 'human'; id: string; side?: 'buyer' | 'merchant' } }) {
  const agent = actor.type === 'agent';
  const name = actorName(actor);
  return (
    <span className={`who ${agent ? 'who-agent' : 'who-person'}`}>
      <Icon name={agent ? 'agent' : 'person'} size={14} />
      {name}
    </span>
  );
}

/** How an actor reads to the owner: their agents by label, buyers' assistants as such, people as "You". */
export function actorName(actor: { type: 'agent' | 'human'; id: string; side?: 'buyer' | 'merchant' }): string {
  if (actor.type !== 'agent') return actor.id.startsWith('owner:') ? 'You' : actor.id;
  if (actor.id === 'sayso-ops-agent') return 'Sayso checkout';
  const label = actor.id.split(':')[1] ?? actor.id;
  return actor.side === 'buyer' ? `Buyer's assistant (${label})` : label;
}

export const ACTION_LABEL: Record<string, string> = {
  'refund.create': 'Refund',
  'payment.capture': 'Charge an order',
  'payment.void': 'Release a payment hold',
  'policy.update': 'Change your rules',
  'dispute.accept': 'Accept a dispute',
  'invoice.send': 'Send an invoice',
  'checkout.create': 'Purchase',
};
