// Earned autonomy: Sayso reads the owner's own say-so decisions and suggests rules that would have let
// the agent do what the owner kept approving. It only ever suggests loosening a limit up to amounts the
// owner approved, and never past anything they turned down. Agents can't grab autonomy (a policy change
// from an agent always waits for the owner); they earn it, one decision at a time.
//
// Deterministic and explainable on purpose: every suggestion carries the decisions behind it.

import { createHash } from 'node:crypto';
import { formatMoney, majorUnits } from '../money.ts';
import type { Policy, Rule } from './policy.ts';
import { ACTIONS, type ActionKind, type GuardRecord } from './types.ts';

/** Approvals of the same kind of request before Sayso suggests anything. */
export const APPROVALS_NEEDED = 3;
/** Only recent decisions count: what the owner OK'd months ago says little about today. */
export const LOOKBACK_DAYS = 30;

type AskRule = Extract<Rule, { type: 'max_amount' | 'always_approve' }>;

export interface RuleSuggestion {
  /** Stable for the same change, so the owner (or an agent) can refer to it. */
  id: string;
  ruleId: string;
  title: string;
  /** The decisions behind it, in plain words. */
  evidence: string;
  /** Limit before and after, in minor units (undefined before: the rule asked about every amount). */
  from?: number;
  to: number;
  /** The whole policy with this one change applied: what accepting it submits. */
  policy: Policy;
}

/** How far each ask-the-owner rule is from a suggestion, for showing that Sayso is learning. */
export interface Learning {
  ruleId: string;
  kind: ActionKind;
  approvals: number;
  rejections: number;
  needed: number;
}

export interface Autonomy {
  suggestions: RuleSuggestion[];
  learning: Learning[];
}

interface Decided {
  amount: number;
  approved: boolean;
}

/** `history`: the owner's Guard records, any order; only the last LOOKBACK_DAYS are read. */
export function earnedAutonomy(policy: Policy, history: readonly GuardRecord[], now = new Date()): Autonomy {
  const since = now.getTime() - LOOKBACK_DAYS * 86_400_000;
  const suggestions: RuleSuggestion[] = [];
  const learning: Learning[] = [];

  for (const rule of policy.rules) {
    if (!isAskRule(rule)) continue;
    for (const kind of rule.kinds) {
      if (kind === 'policy.update') continue; // rules about rules never loosen themselves
      const decided = decisionsUnder(rule, kind, history, since);
      const approvals = decided.filter((d) => d.approved);
      const lowestRejected = Math.min(...decided.filter((d) => !d.approved).map((d) => d.amount));
      // Only what the owner approved below everything they turned down supports a higher limit.
      const support = approvals.filter((d) => d.amount < lowestRejected);
      learning.push({ ruleId: rule.id, kind, approvals: support.length, rejections: decided.length - approvals.length, needed: APPROVALS_NEEDED });
      if (support.length < APPROVALS_NEEDED) continue;

      const highest = Math.max(...support.map((d) => d.amount));
      // A round number when that stays below every rejection; otherwise exactly the highest approval.
      const rounded = roundUp(highest, majorUnits(10, policy.currency));
      const to = rounded < lowestRejected ? rounded : highest;
      const from = rule.type === 'max_amount' ? rule.limit : undefined;
      if (from !== undefined && to <= from) continue;
      suggestions.push(suggestion(policy, rule, kind, support, decided.length - approvals.length, from, to));
    }
  }
  return { suggestions, learning };
}

function suggestion(policy: Policy, rule: AskRule, kind: ActionKind, support: Decided[], rejections: number, from: number | undefined, to: number): RuleSuggestion {
  const money = (minor: number) => formatMoney(minor, policy.currency);
  const noun = ACTIONS[kind].noun;
  const amounts = support.map((d) => d.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const range = low === high ? `of ${money(high)}` : `from ${money(low)} to ${money(high)}`;
  const declined = rejections ? `You turned down ${rejections} bigger one${rejections > 1 ? 's' : ''}, so the limit stays below ${rejections > 1 ? 'those' : 'it'}.` : 'You turned none down.';
  const id = `sug_${createHash('sha256').update(`${policy.ownerId}:${rule.id}:${kind}:${to}`).digest('hex').slice(0, 12)}`;

  return {
    id,
    ruleId: rule.id,
    title: `Let your agent handle ${noun} up to ${money(to)} on its own`,
    evidence: `In the last ${LOOKBACK_DAYS} days you approved ${support.length} ${noun} ${range} that your agent asked about. ${declined}`,
    from,
    to,
    policy: {
      ...policy,
      source: `${policy.source ? `${policy.source} ` : ''}Earned from my approvals: ${noun} up to ${money(to)} no longer need my OK.`,
      rules: withLimit(policy.rules, rule, kind, to),
    },
  };
}

/** The rule's other kinds keep asking as before; only `kind` gets the new limit. */
function withLimit(rules: readonly Rule[], rule: AskRule, kind: ActionKind, limit: number): Rule[] {
  const rest = rule.kinds.filter((k) => k !== kind);
  // A rule about one kind keeps its id, so the decisions made under it keep counting.
  const raised: Rule = { id: rest.length ? `${rule.id}-${kind}` : rule.id, type: 'max_amount', kinds: [kind], limit, then: 'require_approval' };
  return rules.flatMap((r) => (r !== rule ? [r] : rest.length ? [{ ...rule, kinds: rest }, raised] : [raised]));
}

/** Agent requests of `kind` this rule held for the owner, and how the owner decided them. */
function decisionsUnder(rule: AskRule, kind: ActionKind, history: readonly GuardRecord[], since: number): Decided[] {
  return history.flatMap((record) => {
    const { action } = record;
    if (action.kind !== kind || action.actor.type !== 'agent' || Date.parse(record.createdAt) < since) return [];
    if (!record.decision?.hits.some((h) => h.ruleId === rule.id)) return [];
    const amount = action.amount ?? record.simulation?.amount;
    const decision = record.events.find((e) => (e.type === 'approved' || e.type === 'rejected') && e.by.startsWith('owner:'));
    if (amount === undefined || !decision) return [];
    return [{ amount, approved: decision.type === 'approved' }];
  });
}

function isAskRule(rule: Rule): rule is AskRule {
  return (rule.type === 'max_amount' && rule.then === 'require_approval') || rule.type === 'always_approve';
}

function roundUp(amount: number, step: number): number {
  return Math.ceil(amount / step) * step;
}
