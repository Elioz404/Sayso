// Declarative say-so policies. Owners write them in plain English in the dashboard; the LLM turns that
// text into these rules (validated, never executed as code), and they are evaluated here
// deterministically. The model never decides whether money moves: these rules do.

import { formatMoney } from '../money.ts';
import type { ActionKind, Decision, GuardRecord, ProposedAction, RuleHit, Verdict } from './types.ts';

type Escalation = Exclude<Verdict, 'allow'>;

export type Rule =
  /** Single action above `limit` -> escalate. */
  | { id: string; type: 'max_amount'; kinds: ActionKind[]; limit: number; then: Escalation }
  /** Running total over the last 24h (including this action) above `limit` -> escalate. */
  | { id: string; type: 'daily_total'; kinds: ActionKind[]; limit: number; then: Escalation }
  /** These kinds always need a human, whatever the amount. */
  | { id: string; type: 'always_approve'; kinds: ActionKind[] }
  /** These kinds are never allowed for agents. */
  | { id: string; type: 'never'; kinds: ActionKind[] }
  /** Counterparty must be on the allow-list, otherwise escalate. */
  | { id: string; type: 'known_counterparty'; kinds: ActionKind[]; allowed: string[]; then: Escalation }
  /** Buyer mandates: only these categories. */
  | { id: string; type: 'categories'; kinds: ActionKind[]; allowed: string[]; then: Escalation }
  /** Same kind + resource + amount again within the window -> deny as a likely duplicate. */
  | { id: string; type: 'no_duplicates'; kinds: ActionKind[]; windowMinutes: number };

export interface Policy {
  ownerId: string;
  rules: Rule[];
  /** The owner's original words, kept for the audit trail and the UI. */
  source?: string;
}

const SEVERITY: Record<Verdict, number> = { allow: 0, require_approval: 1, deny: 2 };

/**
 * Evaluate a proposed action. `history` is the owner's recent records (for daily totals and
 * duplicates). The most severe hit wins: deny > require_approval > allow.
 */
export function evaluate(policy: Policy, action: ProposedAction, history: GuardRecord[], now = new Date()): Decision {
  const hits: RuleHit[] = [];
  const money = (minor: number) => formatMoney(minor, action.currency ?? 'USD');

  for (const rule of policy.rules) {
    if (!rule.kinds.includes(action.kind)) continue;

    switch (rule.type) {
      case 'max_amount':
        if ((action.amount ?? 0) > rule.limit) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `${money(action.amount ?? 0)} is over the ${money(rule.limit)} limit for ${label(action.kind)}.` });
        }
        break;

      case 'daily_total': {
        const since = now.getTime() - 86_400_000;
        const spent = history
          .filter((r) => rule.kinds.includes(r.action.kind) && countsAsSpent(r) && Date.parse(r.createdAt) >= since)
          .reduce((sum, r) => sum + (r.action.amount ?? 0), 0);
        const total = spent + (action.amount ?? 0);
        if (total > rule.limit) {
          hits.push({ ruleId: rule.id, verdict: rule.then, message: `This would bring today's ${label(action.kind)} total to ${money(total)}, over the ${money(rule.limit)} daily limit.` });
        }
        break;
      }

      case 'always_approve':
        hits.push({ ruleId: rule.id, verdict: 'require_approval', message: `${capitalize(label(action.kind))} always needs your OK.` });
        break;

      case 'never':
        hits.push({ ruleId: rule.id, verdict: 'deny', message: `Agents may not perform ${label(action.kind)}.` });
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

      case 'no_duplicates': {
        const since = now.getTime() - rule.windowMinutes * 60_000;
        const dup = history.find(
          (r) =>
            r.action.kind === action.kind &&
            r.action.resourceId === action.resourceId &&
            r.action.amount === action.amount &&
            countsAsSpent(r) &&
            Date.parse(r.createdAt) >= since,
        );
        if (dup) {
          hits.push({ ruleId: rule.id, verdict: 'deny', message: `Looks like a duplicate of ${dup.id} from ${minutesAgo(dup.createdAt, now)} min ago.` });
        }
        break;
      }
    }
  }

  const verdict = hits.reduce<Verdict>((worst, h) => (SEVERITY[h.verdict] > SEVERITY[worst] ? h.verdict : worst), 'allow');
  return { verdict, hits };
}

/** Records that moved (or are about to move) money count toward limits and duplicate checks. */
function countsAsSpent(r: GuardRecord): boolean {
  return r.status === 'executed' || r.status === 'verified' || r.status === 'executing' || r.status === 'pending_approval';
}

function label(kind: ActionKind): string {
  return {
    'checkout.create': 'purchases',
    'payment.capture': 'payment captures',
    'payment.void': 'authorization voids',
    'refund.create': 'refunds',
    'invoice.send': 'invoices',
    'dispute.accept': 'accepting disputes',
  }[kind];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function minutesAgo(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
}

/** Sensible defaults for a new shop, so Guard is useful before the owner writes anything. */
export function defaultMerchantPolicy(ownerId: string): Policy {
  return {
    ownerId,
    source: 'Default: refunds over $50 and any dispute acceptance need my OK; never repeat a refund.',
    rules: [
      { id: 'refund-cap', type: 'max_amount', kinds: ['refund.create'], limit: 5_000, then: 'require_approval' },
      { id: 'refund-daily', type: 'daily_total', kinds: ['refund.create'], limit: 20_000, then: 'require_approval' },
      { id: 'refund-dup', type: 'no_duplicates', kinds: ['refund.create', 'payment.capture'], windowMinutes: 60 },
      { id: 'disputes-human', type: 'always_approve', kinds: ['dispute.accept'] },
    ],
  };
}

export function defaultBuyerPolicy(ownerId: string): Policy {
  return {
    ownerId,
    source: 'Default: my agent can buy up to $100 per order and $250 a day; ask me above that.',
    rules: [
      { id: 'order-cap', type: 'max_amount', kinds: ['checkout.create'], limit: 10_000, then: 'require_approval' },
      { id: 'daily-cap', type: 'daily_total', kinds: ['checkout.create'], limit: 25_000, then: 'require_approval' },
      { id: 'no-dup-orders', type: 'no_duplicates', kinds: ['checkout.create'], windowMinutes: 10 },
    ],
  };
}
