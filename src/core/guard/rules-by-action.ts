// A shop's rules read per action, the way an owner thinks about them: for refunds, invoices, charges and
// rule changes, what an agent may do on its own, what waits for the owner's OK and what is blocked.
// Derived from the same rules Guard evaluates, never stored apart from them.

import { formatMoney } from '../money.ts';
import type { Policy, Rule } from './policy.ts';
import type { ActionKind } from './types.ts';

export interface ActionRules {
  kind: ActionKind;
  /** "Refunds". */
  label: string;
  /** "Up to $50.00", "Any amount" or "Never". */
  alone: string;
  /** What waits for the owner: "Over $50.00", "More than $200.00 in 24 hours"... */
  ask: string[];
  /** What never reaches PayPal: "The same one again within 60 minutes"... */
  block: string[];
}

/** The owner-side actions Guard governs, in the order owners meet them. Purchases are the buyers' side. */
const SHOWN: { kind: ActionKind; label: string }[] = [
  { kind: 'refund.create', label: 'Refunds' },
  { kind: 'invoice.send', label: 'Invoices' },
  { kind: 'payment.capture', label: 'Charging paid orders' },
  { kind: 'payment.void', label: 'Releasing payment holds' },
];

export function rulesByAction(policy: Policy): ActionRules[] {
  const money = (minor: number) => formatMoney(minor, policy.currency);
  const rows = SHOWN.filter(({ kind }) => kind !== 'payment.void' || policy.rules.some((r) => r.kinds.includes(kind))).map(({ kind, label }) => {
    const rules = policy.rules.filter((r) => r.kinds.includes(kind));
    const ask: string[] = [];
    const block: string[] = [];
    for (const rule of rules) (blocks(rule) ? block : ask).push(condition(rule, money));
    const limits = rules.flatMap((r) => (r.type === 'max_amount' ? [r.limit] : []));
    const never = rules.some((r) => r.type === 'always_approve' || r.type === 'never');
    const alone = never ? 'Never' : limits.length ? `Up to ${money(Math.min(...limits))}` : 'Any amount';
    return { kind, label, alone, ask, block };
  });
  // Rule changes are not a rule of their own: an agent can only ever propose them (Guard holds every one).
  rows.push({ kind: 'policy.update', label: 'Rule changes', alone: 'Never', ask: ['Every change an agent proposes'], block: [] });
  return rows;
}

function blocks(rule: Rule): boolean {
  return rule.type === 'never' || rule.type === 'no_duplicates' || ('then' in rule && rule.then === 'deny');
}

/** The rule's condition alone; the row already names the action. */
function condition(rule: Rule, money: (minor: number) => string): string {
  switch (rule.type) {
    case 'max_amount':
      return `Over ${money(rule.limit)}`;
    case 'daily_total':
      return `More than ${money(rule.limit)} in 24 hours`;
    case 'always_approve':
    case 'never':
      return 'Every one';
    case 'known_counterparty':
      return `To anyone but ${rule.allowed.join(', ')}`;
    case 'categories':
      return `Outside ${rule.allowed.join(', ')}`;
    case 'no_duplicates':
      return `The same one again within ${rule.windowMinutes} minutes`;
    case 'new_counterparty':
      return 'To someone who has never paid you';
  }
}
