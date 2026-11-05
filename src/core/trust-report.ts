// The Trust report's data: what agents did with the owner's money and what Guard did about it, where sales
// came from, and each order's money trail checked against PayPal and the audit chain. Plain rows, one
// table per question, so a reporting tool can slice them; nothing here decides anything.

import { OPS_AGENT } from './actors.ts';
import { ACTIONS, type ActionKind, type GuardRecord, type RecordStatus } from './guard/types.ts';
import { formatMoney, toMoney } from './money.ts';
import type { OrderSummary } from './orders.ts';

export type Outcome = 'Allowed by your rules' | 'You said OK' | 'Waiting for you' | 'You said no' | 'Blocked by a rule' | 'Failed';

/** The colour an outcome shows in (the status-* classes). */
export type Tone = 'ok' | 'hold' | 'stop' | 'quiet';
export const OUTCOME_TONE: Readonly<Record<Outcome, Tone>> = {
  'Allowed by your rules': 'ok',
  'You said OK': 'ok',
  'Waiting for you': 'hold',
  'You said no': 'quiet',
  'Blocked by a rule': 'stop',
  Failed: 'stop',
};
export type Who = 'Your agents' | "Buyers' assistants" | 'You' | 'Sayso checkout';

/** One request Guard handled, with one money column per outcome so totals by outcome are simple sums. */
export interface DecisionRow {
  id: string;
  day: string;
  action: string;
  who: Who;
  outcome: Outcome;
  amount: number;
  movedAlone: number;
  approved: number;
  waiting: number;
  declined: number;
  blocked: number;
  requests: number;
  /** 1 under this request's outcome, 0 elsewhere: counts per outcome as sums, in the same order as the money columns. */
  nAlone: number;
  nApproved: number;
  nWaiting: number;
  nDeclined: number;
  nBlocked: number;
  /** Minutes from the request to the owner's answer, when the owner answered. */
  minutesToDecide?: number;
  why: string;
  readBack: 'Read back from PayPal' | 'Not yet' | 'Could not confirm' | 'Nothing to read';
  chain: 'Intact' | 'Edited';
}

export interface SaleRow {
  order: string;
  day: string;
  channel: string;
  total: number;
  refunded: number;
  net: number;
  orders: number;
  status: string;
}

export interface TrailRow {
  order: string;
  day: string;
  buyer: string;
  channel: string;
  total: number;
  refunded: number;
  moneyMoves: number;
  readBack: string;
  chain: string;
}

export interface TrustReport {
  decisions: DecisionRow[];
  sales: SaleRow[];
  trail: TrailRow[];
  /** One line each, for the report's notes. */
  facts: { refundLimit?: string; records: number; readBack: number; chainIntact: boolean };
}

const SPENT: readonly RecordStatus[] = ['executing', 'executed', 'verified', 'unverified'];

export function outcomeOf(record: Pick<GuardRecord, 'status' | 'events'>): Outcome {
  switch (record.status) {
    case 'pending_approval':
      return 'Waiting for you';
    case 'denied':
      return 'Blocked by a rule';
    case 'rejected':
      return 'You said no';
    case 'failed':
      return 'Failed';
    default:
      return record.events.some((e) => e.type === 'approved') ? 'You said OK' : 'Allowed by your rules';
  }
}

export function whoOf({ actor }: Pick<GuardRecord['action'], 'actor'>): Who {
  if (actor.type === 'human') return 'You';
  if (actor.id === OPS_AGENT.id) return 'Sayso checkout';
  return actor.side === 'buyer' ? "Buyers' assistants" : 'Your agents';
}

/** Where an order came from, in words an owner knows. */
export function channelName(channel?: string): string {
  switch (channel) {
    case 'sayso-assistant':
      return 'Shop with AI on Sayso';
    case 'sayso-cart':
      return 'Cart on Sayso';
    case 'owner-agent':
      return 'Your agent';
    case 'paypal-platform':
      return 'PayPal merchant-cart API';
    case 'tour':
      return 'Judges tour';
    case undefined:
    case '':
      return 'Unknown';
    default:
      return 'AI assistants over MCP';
  }
}

const day = (iso: string) => iso.slice(0, 10);

export function trustReport(records: (GuardRecord & { chainIntact: boolean })[], orders: OrderSummary[], currency: string, refundLimit?: number): TrustReport {
  // Amounts as numbers in the shop's currency (minor units stay internal), for sums and charts.
  const money = (minor = 0) => Number(toMoney(minor, currency).value);
  // Captures after a buyer approved in PayPal are the buyer's own payment (they show under sales), not a
  // request an agent made of the owner's money.
  const asked = records.filter((r) => whoOf(r.action) !== 'Sayso checkout');
  const decisions: DecisionRow[] = asked.map((r) => {
    const outcome = outcomeOf(r);
    const amount = r.action.kind === 'policy.update' ? 0 : money(r.action.amount ?? r.simulation?.amount);
    const proposed = r.events.find((e) => e.type === 'proposed')?.at ?? r.createdAt;
    const answered = r.events.find((e) => e.type === 'approved' || e.type === 'rejected')?.at;
    return {
      id: r.id,
      day: day(r.createdAt),
      action: r.action.kind in ACTIONS ? ACTIONS[r.action.kind as ActionKind].label : r.action.kind,
      who: whoOf(r.action),
      outcome,
      amount,
      movedAlone: outcome === 'Allowed by your rules' ? amount : 0,
      approved: outcome === 'You said OK' ? amount : 0,
      waiting: outcome === 'Waiting for you' ? amount : 0,
      declined: outcome === 'You said no' ? amount : 0,
      blocked: outcome === 'Blocked by a rule' ? amount : 0,
      requests: 1,
      nAlone: Number(outcome === 'Allowed by your rules'),
      nApproved: Number(outcome === 'You said OK'),
      nWaiting: Number(outcome === 'Waiting for you'),
      nDeclined: Number(outcome === 'You said no'),
      nBlocked: Number(outcome === 'Blocked by a rule'),
      ...(answered ? { minutesToDecide: Math.max(0, Math.round((Date.parse(answered) - Date.parse(proposed)) / 60_000)) } : {}),
      why: r.decision?.hits.map((h) => h.message).join(' ') || r.action.reason,
      readBack: !SPENT.includes(r.status) ? 'Nothing to read' : r.verification ? (r.verification.ok ? 'Read back from PayPal' : 'Could not confirm') : 'Not yet',
      chain: r.chainIntact ? 'Intact' : 'Edited',
    };
  });

  const placed = orders.filter((o) => o.number);
  const sales: SaleRow[] = placed.map((o) => ({
    order: o.number!,
    day: day(o.createdAt),
    channel: channelName(o.channel),
    total: money(o.totalMinor),
    refunded: money(o.refundedMinor),
    net: money((o.totalMinor ?? 0) - o.refundedMinor),
    orders: 1,
    status: o.status,
  }));

  // An order's money moves are the Guard records about its cart.
  const byCart = new Map<string, (GuardRecord & { chainIntact: boolean })[]>();
  for (const r of records) {
    const cartId = typeof r.action.params?.cartId === 'string' ? r.action.params.cartId : undefined;
    if (cartId) byCart.set(cartId, [...(byCart.get(cartId) ?? []), r]);
  }
  const trail: TrailRow[] = placed.map((o) => {
    const moves = (byCart.get(o.id) ?? []).filter((r) => SPENT.includes(r.status));
    const confirmed = moves.filter((r) => r.verification?.ok).length;
    return {
      order: o.number!,
      day: day(o.createdAt),
      buyer: o.buyer ?? '',
      channel: channelName(o.channel),
      total: money(o.totalMinor),
      refunded: money(o.refundedMinor),
      moneyMoves: moves.length,
      readBack: moves.length === 0 ? 'Nothing moved yet' : confirmed === moves.length ? `All ${moves.length} read back from PayPal` : `${confirmed} of ${moves.length} read back`,
      chain: moves.every((r) => r.chainIntact) ? 'Intact' : 'Edited',
    };
  });

  const spent = records.filter((r) => SPENT.includes(r.status));
  return {
    decisions,
    sales,
    trail,
    facts: {
      refundLimit: refundLimit === undefined ? undefined : formatMoney(refundLimit, currency),
      records: records.length,
      readBack: spent.filter((r) => r.verification?.ok).length,
      chainIntact: records.every((r) => r.chainIntact),
    },
  };
}
