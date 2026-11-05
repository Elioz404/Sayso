// Declarative say-so policies. Owners write them in plain English; the LLM turns that text into these
// rules (validated, never executed as code), and they are evaluated here deterministically. The model
// never decides whether money moves: these rules do.

import { formatMoney, majorUnits } from '../money.ts';
import { ACTIONS, SPENDING_STATUSES, type ActionKind, type Decision, type GuardRecord, type ProposedAction, type RuleHit, type Verdict } from './types.ts';

type Escalation = Exclude<Verdict, 'allow'>;

export type Rule =
  /** Single action above `limit` -> escalate. */
  | { id: string; type: 'max_amount'; kinds: ActionKind[]; limit: number; then: Escalation }
  /** Running total over the last 24h (including this action) above `limit` -> escalate. */
  | { id: string; type: 'daily_total'; kinds: ActionKind[]; limit: number; then: Escalation }
  /** These kinds always need a human, whatever the amount. */
  | { id: string; type: 'always_approve'; kinds: ActionKind[] }
  /** These kinds are never allowed for agents (the owner can still do them). */
  | { id: string; type: 'never'; kinds: ActionKind[] }
  /** Counterparty must be on the allow-list, otherwise escalate. */
  | { id: string; type: 'known_counterparty'; kinds: ActionKind[]; allowed: string[]; then: Escalation }
  /** Buyer mandates: only these categories. */
  | { id: string; type: 'categories'; kinds: ActionKind[]; allowed: string[]; then: Escalation }
  /** Same kind + resource + amount again within the window -> deny as a likely duplicate. */
  | { id: string; type: 'no_duplicates'; kinds: ActionKind[]; windowMinutes: number }
  /** Someone who has never paid this owner (the caller sets `params.newCounterparty`) -> escalate. */
  | { id: string; type: 'new_counterparty'; kinds: ActionKind[]; then: Escalation };

export type RuleType = Rule['type'];
export const RULE_TYPES: readonly RuleType[] = ['max_amount', 'daily_total', 'always_approve', 'never', 'known_counterparty', 'categories', 'no_duplicates', 'new_counterparty'];

export interface Policy {
  ownerId: string;
  rules: Rule[];
  /** Currency the limits are written in. */
  currency: string;
  /** The owner's original words, kept for the audit trail and the UI. */
  source?: string;
}

const DAY_MS = 86_400_000;
const SEVERITY: Record<Verdict, number> = { allow: 0, require_approval: 1, deny: 2 };

/** How far back Guard must look for this policy: a day, or the longest duplicate window. */
export function historyWindowMs(policy: Policy): number {
  const windows = policy.rules.flatMap((r) => (r.type === 'no_duplicates' ? [r.windowMinutes * 60_000] : []));
  return Math.max(DAY_MS, ...windows);
}

export function countsAsSpent(record: GuardRecord): boolean {
  return SPENDING_STATUSES.includes(record.status);
}

/**
 * Evaluate a proposed action. `history` is the owner's recent records (see historyWindowMs). The most
 * severe hit wins: deny > require_approval > allow.
 */
export function evaluate(policy: Policy, action: ProposedAction, history: GuardRecord[], now = new Date()): Decision {
  const hits: RuleHit[] = [];
  const money = (minor: number) => formatMoney(minor, action.currency ?? policy.currency);
  const noun = ACTIONS[action.kind].noun;

  for (const rule of policy.rules) {
    if (!rule.kinds.includes(action.kind)) continue;

    switch (rule.type) {
      case 'max_amount':
        if ((action.amount ?? 0) > rule.limit) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `${money(action.amount ?? 0)} is over the ${money(rule.limit)} limit for ${noun}.` });
        }
        break;

      case 'daily_total': {
        const since = now.getTime() - DAY_MS;
        const spent = history
          .filter((r) => rule.kinds.includes(r.action.kind) && countsAsSpent(r) && Date.parse(r.createdAt) >= since)
          .reduce((sum, r) => sum + (r.action.amount ?? 0), 0);
        const total = spent + (action.amount ?? 0);
        if (total > rule.limit) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `This would bring today's ${noun} total to ${money(total)}, over the ${money(rule.limit)} daily limit.` });
        }
        break;
      }

      case 'always_approve':
        hits.push({ ruleId: rule.id, verdict: 'require_approval', message: `${capitalize(noun)} always need your OK.` });
        break;

      case 'never':
        if (action.actor.type === 'agent') hits.push({ ruleId: rule.id, verdict: 'deny', message: `Agents may not do ${noun}.` });
        break;

      case 'known_counterparty': {
        const who = action.counterparty?.toLowerCase();
        if (!who || !rule.allowed.map((a) => a.toLowerCase()).includes(who)) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `${action.counterparty ?? 'Unknown recipient'} is not on your trusted list.` });
        }
        break;
      }

      case 'categories':
        if (!action.category || !rule.allowed.includes(action.category)) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `Category "${action.category ?? 'unknown'}" is outside your mandate (${rule.allowed.join(', ')}).` });
        }
        break;

      case 'new_counterparty':
        if (action.params?.newCounterparty === true) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `${action.counterparty ?? 'This person'} has never paid you before.` });
        }
        break;

      case 'no_duplicates': {
        const dup = findDuplicate(action, history, now.getTime() - rule.windowMinutes * 60_000);
        if (dup) hits.push({ ruleId: rule.id, verdict: 'deny', message: `Looks like a duplicate of ${dup.id} from ${minutesAgo(dup.createdAt, now)} min ago.` });
        break;
      }
    }
  }

  const verdict = hits.reduce<Verdict>((worst, h) => (SEVERITY[h.verdict] > SEVERITY[worst] ? h.verdict : worst), 'allow');
  return { verdict, hits };
}

/** The same kind, resource and amount, still counting as spent, created at or after `sinceMs`. */
export function findDuplicate(action: ProposedAction, history: GuardRecord[], sinceMs: number): GuardRecord | undefined {
  return history.find(
    (r) =>
      r.action.kind === action.kind &&
      r.action.resourceId === action.resourceId &&
      r.action.amount === action.amount &&
      countsAsSpent(r) &&
      Date.parse(r.createdAt) >= sinceMs,
  );
}

export function minutesAgo(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Sensible defaults for a new shop, in its currency, so Guard is useful before the owner writes anything. */
/** The thresholds new shops and new buyers start with, in major units of their currency. */
export const DEFAULT_LIMITS = { refundApproval: 50, refundDaily: 200, invoiceApproval: 200, buyerOrder: 100, buyerDaily: 250 } as const;

export function defaultMerchantPolicy(ownerId: string, currency: string): Policy {
  const amount = (units: number) => majorUnits(units, currency);
  const money = (units: number) => formatMoney(amount(units), currency);
  const d = DEFAULT_LIMITS;
  return {
    ownerId,
    currency,
    source: `Default: refunds over ${money(d.refundApproval)} need my OK; invoices over ${money(d.invoiceApproval)} or to someone who has never paid me need my OK; never repeat a refund or an invoice within the hour.`,
    rules: [
      { id: 'refund-cap', type: 'max_amount', kinds: ['refund.create'], limit: amount(d.refundApproval), then: 'require_approval' },
      { id: 'refund-daily', type: 'daily_total', kinds: ['refund.create'], limit: amount(d.refundDaily), then: 'require_approval' },
      { id: 'no-repeats', type: 'no_duplicates', kinds: ['refund.create', 'payment.capture', 'invoice.send'], windowMinutes: 60 },
      { id: 'invoice-cap', type: 'max_amount', kinds: ['invoice.send'], limit: amount(d.invoiceApproval), then: 'require_approval' },
      { id: 'invoice-new-client', type: 'new_counterparty', kinds: ['invoice.send'], then: 'require_approval' },
    ],
  };
}

export function defaultBuyerPolicy(ownerId: string, currency: string): Policy {
  const amount = (units: number) => majorUnits(units, currency);
  const money = (units: number) => formatMoney(amount(units), currency);
  return {
    ownerId,
    currency,
    source: `Default: my assistant can buy up to ${money(DEFAULT_LIMITS.buyerOrder)} per order and ${money(DEFAULT_LIMITS.buyerDaily)} a day; ask me above that.`,
    rules: [
      { id: 'order-cap', type: 'max_amount', kinds: ['checkout.create'], limit: amount(DEFAULT_LIMITS.buyerOrder), then: 'require_approval' },
      { id: 'daily-cap', type: 'daily_total', kinds: ['checkout.create'], limit: amount(DEFAULT_LIMITS.buyerDaily), then: 'require_approval' },
      { id: 'no-dup-orders', type: 'no_duplicates', kinds: ['checkout.create'], windowMinutes: 10 },
    ],
  };
}

/** Minor units: above this amount, `kind` waits for the owner (the lowest such limit), if a rule says so. */
export function approvalLimit(policy: Policy, kind: ActionKind): number | undefined {
  const limits = policy.rules.flatMap((r) => (r.type === 'max_amount' && r.then === 'require_approval' && r.kinds.includes(kind) ? [r.limit] : []));
  return limits.length ? Math.min(...limits) : undefined;
}

/** The same rules, with `kind`'s ask-the-owner limit set to `limit` (minor units). */
export function withApprovalLimit(policy: Policy, kind: ActionKind, limit: number): Policy {
  return { ...policy, rules: policy.rules.map((r) => (r.type === 'max_amount' && r.then === 'require_approval' && r.kinds.includes(kind) ? { ...r, limit } : r)) };
}
