// Where each owner's say-so policy lives, and the Guard executor that replaces it. Changing a policy
// is itself a Guard action (`policy.update`), so it gets the same simulate -> approve -> verify -> audit
// treatment as moving money.

import { createHash } from 'node:crypto';
import { formatMoney } from '../money.ts';
import { canonicalJson } from './engine.ts';
import type { Policy, Rule } from './policy.ts';
import { ACTIONS, type ActionKind, type Executor } from './types.ts';

export interface PolicyStore {
  get(ownerId: string): Promise<Policy | undefined>;
  put(policy: Policy): Promise<void>;
}

export class MemoryPolicyStore implements PolicyStore {
  private readonly policies = new Map<string, Policy>();
  async get(ownerId: string) {
    const p = this.policies.get(ownerId);
    return p && structuredClone(p);
  }
  async put(policy: Policy) {
    this.policies.set(policy.ownerId, structuredClone(policy));
  }
}

/** Which version of a policy's rules this is, so a proposal can say what it was written against. */
export function policyVersion(policy: Policy): string {
  return createHash('sha256').update(canonicalJson(policy.rules)).digest('hex').slice(0, 16);
}

export const STALE_PROPOSAL = 'The rules changed since this was proposed, so it was not applied; ask again';

/**
 * `params.policy` holds the proposed Policy; `params.base` the version of the rules it was written
 * against. A proposal replaces the whole policy, so if the rules changed while it waited (the owner
 * adopted something else, say), applying it would silently undo that change: it fails instead.
 * `current` is the policy in force (the default if none saved).
 */
export function policyUpdateExecutor(store: PolicyStore, current: (ownerId: string) => Promise<Policy>): Executor {
  const proposed = (params: Record<string, unknown> | undefined): Policy => {
    const policy = params?.policy as Policy | undefined;
    if (!policy || !Array.isArray(policy.rules)) throw new Error('Missing params.policy');
    return policy;
  };

  return {
    async simulate(action) {
      const next = proposed(action.params);
      const blockers = next.ownerId !== action.ownerId ? ['Policy belongs to a different owner.'] : [];
      const now = await current(action.ownerId);
      if (stale(action.params, now)) blockers.push(`${STALE_PROPOSAL}.`);
      return {
        ok: blockers.length === 0,
        blockers,
        // No amount: a rule change moves no money, so it shows without one.
        effects: [`Replace ${now.rules.length} rule(s) with ${next.rules.length}:`, ...next.rules.map((r) => `- ${describeRule(r, next.currency)}`)],
        observed: { current_rules: now.rules.length },
      };
    },
    async execute(action) {
      const next = proposed(action.params);
      if (stale(action.params, await current(action.ownerId))) throw new Error(STALE_PROPOSAL);
      await store.put({ ...next, ownerId: action.ownerId });
      return { rules: next.rules.length };
    },
    async verify(action) {
      const saved = await store.get(action.ownerId);
      const ok = saved !== undefined && canonicalJson(saved.rules) === canonicalJson(proposed(action.params).rules);
      return { ok, detail: ok ? `Policy now has ${saved.rules.length} rule(s).` : 'Saved policy does not match the proposal.' };
    },
  };
}

function stale(params: Record<string, unknown> | undefined, now: Policy): boolean {
  return typeof params?.base === 'string' && params.base !== policyVersion(now);
}

/** One line per rule, for approval screens, the CLI and agents: "Refunds over $50.00 need the owner's OK". */
export function describeRule(rule: Rule, currency: string): string {
  const what = nouns(rule.kinds);
  const money = (minor: number) => formatMoney(minor, currency);
  const then = 'then' in rule ? (rule.then === 'deny' ? 'are blocked' : "need the owner's OK") : '';
  switch (rule.type) {
    case 'max_amount':
      return `${what} over ${money(rule.limit)} ${then}`;
    case 'daily_total':
      return `${what} adding up to more than ${money(rule.limit)} in 24 hours ${then}`;
    case 'always_approve':
      return `${what} always need the owner's OK`;
    case 'never':
      return `${what} are never allowed for agents`;
    case 'known_counterparty':
      return `${what} to anyone but ${rule.allowed.join(', ')} ${then}`;
    case 'categories':
      return `${what} outside ${rule.allowed.join(', ')} ${then}`;
    case 'no_duplicates':
      return `${what} repeated within ${rule.windowMinutes} minutes are blocked`;
    case 'new_counterparty':
      return `${what} to someone who has never paid the shop ${then}`;
  }
}

/** ["refund.create", "invoice.send"] -> "Refunds and invoices". */
function nouns(kinds: readonly ActionKind[]): string {
  const words = kinds.map((k) => ACTIONS[k].noun);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : (words[0] ?? 'Actions');
  return list.charAt(0).toUpperCase() + list.slice(1);
}
