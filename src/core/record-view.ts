// How one Guard record reads to the owner: a row in Activity and the receipt it opens. Each part follows
// the record as it is now (waiting for the owner, then their answer, then PayPal's read-back), never only
// what it was when the request came in.

import { actionLabel, actorName } from './actors.ts';
import { actionAmount } from './guard/describe.ts';
import type { GuardRecord, RecordStatus } from './guard/types.ts';
import { outcomeOf, type Outcome } from './trust-report.ts';

/** A Guard record with its hash chain checked (SaySo.audit / SaySo.record). */
type AuditedRecord = GuardRecord & { chainIntact: boolean };

/** ok: PayPal read it back as intended. bad: it didn't. sent: waiting for the read-back. none: nothing went to PayPal. */
export type PayPalCheck = 'ok' | 'bad' | 'sent' | 'none';

export interface RecordView {
  id: string;
  at: string;
  action: string;
  amount?: string;
  /** Nothing moved: blocked, turned down, or PayPal didn't complete it. */
  stopped: boolean;
  counterparty?: string;
  by: string;
  byAgent: boolean;
  /** Why it was asked, in the asker's words. */
  reason: string;
  status: RecordStatus;
  outcome: Outcome;
  /** What it does, or did, worked out before anything ran. */
  effects: string[];
  /** The rules that held it for the owner or blocked it. */
  hits: string[];
  decided?: { approved: boolean; at: string; note?: string };
  paypal: PayPalCheck;
  paypalDetail?: string;
  /** Why it failed, when it did. */
  failure?: string;
  chainIntact: boolean;
  /** The owner's passkey signature on their approval, checked again now. */
  signed?: { ok: boolean; label?: string };
}

const STOPPED: readonly RecordStatus[] = ['denied', 'rejected', 'failed'];
const SENT: readonly RecordStatus[] = ['executing', 'executed'];

export function recordView(record: AuditedRecord, redact: (text: string) => string, signed?: { ok: boolean; label?: string }): RecordView {
  const { action } = record;
  const decision = record.events.find((e) => e.type === 'approved' || e.type === 'rejected');
  const note = typeof decision?.data?.note === 'string' && decision.data.note ? redact(decision.data.note) : undefined;
  const error = record.events.find((e) => e.type === 'failed')?.data?.error;
  const amount = actionAmount(action);
  return {
    id: record.id,
    at: record.createdAt,
    action: actionLabel(action.kind),
    ...(amount ? { amount } : {}),
    stopped: STOPPED.includes(record.status),
    ...(action.counterparty ? { counterparty: redact(action.counterparty) } : {}),
    by: actorName(action.actor),
    byAgent: action.actor.type === 'agent',
    reason: redact(action.reason),
    status: record.status,
    outcome: outcomeOf(record),
    effects: (record.simulation?.effects ?? []).map((e) => redact(e.replace(/^- /, ''))),
    hits: (record.decision?.hits ?? []).map((h) => redact(h.message)),
    ...(decision ? { decided: { approved: decision.type === 'approved', at: decision.at, ...(note ? { note } : {}) } } : {}),
    paypal: paypalCheck(record),
    ...(record.verification ? { paypalDetail: redact(record.verification.detail) } : {}),
    ...(record.status === 'failed' ? { failure: redact(typeof error === 'string' ? error : (record.verification?.detail ?? 'PayPal did not complete it.')) } : {}),
    chainIntact: record.chainIntact,
    ...(signed ? { signed } : {}),
  };
}

function paypalCheck(record: AuditedRecord): PayPalCheck {
  if (record.action.kind === 'policy.update') return 'none';
  if (record.verification) return record.verification.ok ? 'ok' : 'bad';
  return SENT.includes(record.status) ? 'sent' : 'none';
}

/**
 * The Why column, as things stand: while it waits or after it was blocked, the rule that held it; once
 * the owner answered, their note if they left one; if it failed, what went wrong; otherwise why it was asked.
 */
export function whyNow(v: RecordView): string {
  if (v.status === 'pending_approval' || v.status === 'denied') return v.hits.join(' ') || v.reason;
  if (v.failure) return v.failure;
  if (v.decided?.note) return `Your note: ${v.decided.note}`;
  return v.reason;
}
