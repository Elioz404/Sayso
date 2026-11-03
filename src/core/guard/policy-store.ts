// Where each owner's say-so policy lives, and the Guard executor that replaces it. Changing a policy
// is itself a Guard action (`policy.update`), so it gets the same simulate -> approve -> verify -> audit
// treatment as moving money.

import { formatMoney } from '../money.ts';
import { canonicalJson } from './engine.ts';
import type { Policy, Rule } from './policy.ts';
import type { Executor } from './types.ts';

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

/** `params.policy` holds the proposed Policy. `current` is the policy in force (the default if none saved). */
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
      return {
        ok: blockers.length === 0,
        blockers,
        amount: 0,
        effects: [`Replace ${now.rules.length} rule(s) with ${next.rules.length}:`, ...next.rules.map((r) => `- ${describeRule(r, next.currency)}`)],
        observed: { current_rules: now.rules.length },
      };
    },
    async execute(action) {
      const next = proposed(action.params);
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

/** One line per rule, for approval screens, the CLI and agents. */
export function describeRule(rule: Rule, currency: string): string {
  const kinds = rule.kinds.join(', ');
  const then = 'then' in rule ? (rule.then === 'deny' ? 'block' : 'ask the owner') : '';
  switch (rule.type) {
    case 'max_amount':
      return `${kinds} over ${formatMoney(rule.limit, currency)}: ${then}`;
    case 'daily_total':
      return `${kinds} over ${formatMoney(rule.limit, currency)} in 24h: ${then}`;
    case 'always_approve':
      return `${kinds}: always ask the owner`;
    case 'never':
      return `${kinds}: never allowed for agents`;
    case 'known_counterparty':
      return `${kinds} to anyone but ${rule.allowed.join(', ')}: ${then}`;
    case 'categories':
      return `${kinds} outside ${rule.allowed.join(', ')}: ${then}`;
    case 'no_duplicates':
      return `${kinds} repeated within ${rule.windowMinutes} min: block`;
    case 'new_counterparty':
      return `${kinds} to someone who has never paid you: ${then}`;
  }
}
