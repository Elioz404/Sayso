// Shared presentational pieces: the mark, a small icon set, status pills and who-did-it chips.
// Server-safe (no hooks); interactive pieces live in the client files.

import type { ReactNode } from 'react';
import { OPS_AGENT } from '@/core/actors.ts';
import { ACTIONS, type ActionKind } from '@/core/guard/types.ts';

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
  chart: <path d="M4 20V11M10 20V5M16 20v-6M3 20h18" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />,
  out: <path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H9" />,
  chain: (
    <>
      <rect x="3" y="9" width="8" height="6" rx="3" />
      <rect x="13" y="9" width="8" height="6" rx="3" />
      <path d="M10 12h4" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 17.5h2" />
    </>
  ),
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />,
  fingerprint: <path d="M8.5 19.5c1.3-2 2-4.5 2-7a1.5 1.5 0 0 1 3 0c0 3-.6 5.7-1.8 8M5 15.5c.7-1 1-2.2 1-3.5a6 6 0 0 1 9.5-4.9M18 12c0 2.6-.4 5-1.2 7.2M15.6 20.5c.2-.5.4-1 .5-1.5M7.2 5.5A8.5 8.5 0 0 1 20.5 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  truck: (
    <>
      <path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7" />
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
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
  unverified: 'Unconfirmed',
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
  unverified: 'hold',
  draft: 'hold',
  denied: 'stop',
  rejected: 'stop',
  failed: 'stop',
  released: 'stop',
  // Invoice statuses, as PayPal reports them (lower-cased); "paid" is shared with orders.
  'marked as paid': 'ok',
  'partially paid': 'hold',
  sent: 'hold',
  unpaid: 'hold',
  'waiting for the owner': 'hold',
  cancelled: 'stop',
};

/** ok, hold, stop or quiet: the colour family of a status anywhere in the app. */
export function toneOf(value: string): 'ok' | 'hold' | 'stop' | 'quiet' {
  return STATUS_TONE[value] ?? 'quiet';
}

export function Status({ value }: { value: string }) {
  const label = STATUS_LABEL[value] ?? value.replace(/_/g, ' ');
  return <span className={`status status-${toneOf(value)}`}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>;
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
  if (actor.id === OPS_AGENT.id) return 'Sayso checkout';
  if (actor.id === 'buyer-agent:sayso-order') return 'The buyer (order page)';
  const label = actor.id.split(':')[1] ?? actor.id;
  return actor.side === 'buyer' ? `Buyer's assistant (${label})` : label;
}

/** How an action reads to people, from the one list Guard governs. */
export function actionLabel(kind: string): string {
  return kind in ACTIONS ? ACTIONS[kind as ActionKind].label : kind;
}
