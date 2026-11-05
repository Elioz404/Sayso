// The owner's side of Guard: what waits for their say-so, the audit trail, and the rules themselves.
// Agents can read all of it and propose new rules; only `decide()` approves, and only the owner's
// session reaches it (never a tool or the CLI).

import type { Access } from './access.ts';
import { draftPolicy } from './ai/policy-draft.ts';
import type { ChatModel } from './ai/llm.ts';
import { fromLlmError, HttpError, notFound } from './errors.ts';
import { earnedAutonomy, LOOKBACK_DAYS, type Autonomy } from './guard/autonomy.ts';
import { GuardConflict, verifyAuditChain, type Guard } from './guard/engine.ts';
import type { Policy } from './guard/policy.ts';
import { describeRule, policyVersion } from './guard/policy-store.ts';
import type { Actor, GuardRecord } from './guard/types.ts';
import type { PasskeyProof, Passkeys } from './passkeys.ts';
import type { PolicyLookup } from './policies.ts';
import { RateLimit } from './rate-limit.ts';
import type { Shops } from './shops.ts';

export interface SaySoDeps {
  guard: Guard;
  policyFor: PolicyLookup;
  shops: Shops;
  model?: ChatModel;
  /** Once a shop has a passkey, approving needs a signature from it. */
  passkeys?: Passkeys;
  /** Signs a rules draft between drafting and saving it. */
  access: Pick<Access, 'signValue' | 'verifyValue'>;
}

/** A rules draft the owner read, ready to save: signed, so what is saved is exactly what they read. */
export interface RulesDraft {
  policy: Policy;
  unclear: string[];
  /** What a passkey confirms ("rules:<version>"). */
  version: string;
  /** Pass back to `saveRules`. */
  token: string;
}

export type AuditedRecord = GuardRecord & { chainIntact: boolean };

/** Rule drafts per shop per hour: each one is an AI call on the server's daily budget. */
const DRAFTS_PER_HOUR = 20;
const RULES_DRAFT = 'rules-draft';
const DRAFT_TTL_MS = 30 * 60_000;

export class SaySo {
  private readonly deps: SaySoDeps;
  private readonly drafts = new RateLimit(DRAFTS_PER_HOUR, 3_600_000);

  constructor(deps: SaySoDeps) {
    this.deps = deps;
  }

  pending(shopId: string): Promise<GuardRecord[]> {
    return this.deps.guard.list(shopId, { status: 'pending_approval' });
  }

  /** The shop's records, newest first, each with its hash chain checked. `since`: only those created since then. */
  async audit(shopId: string, limit = 50, since?: Date): Promise<AuditedRecord[]> {
    return (await this.deps.guard.list(shopId, { limit, ...(since ? { since } : {}) })).map(audited);
  }

  async record(shopId: string, recordId: string): Promise<AuditedRecord> {
    const record = await this.deps.guard.get(recordId);
    if (!record || record.action.ownerId !== shopId) throw notFound(`Say-so request ${recordId}`);
    return audited(record);
  }

  policy(shopId: string): Promise<Policy> {
    return this.deps.policyFor(shopId);
  }

  async describePolicy(shopId: string): Promise<{ source?: string; currency: string; rules: string[] }> {
    const policy = await this.policy(shopId);
    return { source: policy.source, currency: policy.currency, rules: policy.rules.map((r) => describeRule(r, policy.currency)) };
  }

  /** Draft rules from the owner's words and submit them. From an agent this always waits for the owner. */
  async proposePolicy(shopId: string, text: string, actor: Actor): Promise<{ record: GuardRecord; unclear: string[] }> {
    const { policy, unclear } = await this.draft(shopId, text);
    return { record: await this.submitPolicy(policy, `New rules: "${text.slice(0, 200)}"`, actor), unclear };
  }

  /**
   * Draft rules from plain words without submitting them: the owner reads them before saving. The draft
   * carries the version of the rules it was written against, so saving it is refused if they changed since.
   */
  async draftRules(shopId: string, text: string): Promise<RulesDraft> {
    const { policy, unclear } = await this.draft(shopId, text);
    const base = policyVersion(await this.policy(shopId));
    const token = this.deps.access.signValue(RULES_DRAFT, Buffer.from(JSON.stringify({ policy, base })).toString('base64url'), DRAFT_TTL_MS);
    return { policy, unclear, version: policyVersion(policy), token };
  }

  /**
   * The owner saves a draft they read. It goes through Guard like any rule change (audited, and refused if
   * the rules changed since it was drafted), confirmed with their passkey once the shop has one.
   */
  async saveRules(shopId: string, token: string, actor: Actor, proof?: PasskeyProof): Promise<GuardRecord> {
    const value = this.deps.access.verifyValue(RULES_DRAFT, token);
    if (!value) throw new HttpError(410, 'This draft is more than 30 minutes old; draft it again');
    const { policy, base } = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { policy: Policy; base: string };
    if (policy.ownerId !== shopId) throw new HttpError(403, 'These rules are for another shop');
    if (actor.type === 'human' && this.deps.passkeys && (await this.deps.passkeys.required(shopId))) {
      await this.deps.passkeys.confirm(shopId, `rules:${policyVersion(policy)}`, proof);
    }
    return this.submitPolicy(policy, `New rules: "${(policy.source ?? '').slice(0, 200)}"`, actor, base);
  }

  private async draft(shopId: string, text: string): Promise<{ policy: Policy; unclear: string[] }> {
    if (!this.deps.model) throw new HttpError(503, 'Policy drafting needs an AI key (OPENAI_API_KEY or DEEPSEEK_API_KEY) on the server');
    if (!this.drafts.allow(shopId)) throw new HttpError(429, `Up to ${DRAFTS_PER_HOUR} rule drafts an hour; try again later`);
    const { shop } = await this.deps.shops.get(shopId);
    return draftPolicy(this.deps.model, shopId, text, shop.currency).catch((err: unknown) => {
      throw fromLlmError(err, 'Could not draft that policy');
    });
  }

  /** Rules the owner's own approvals support, and how close the others are. Recomputed every time. */
  async autonomy(shopId: string, now = new Date()): Promise<Autonomy> {
    const history = await this.deps.guard.list(shopId, { since: new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000) });
    return earnedAutonomy(await this.policy(shopId), history, now);
  }

  /**
   * Submit a suggested rule. From the owner it applies at once (confirmed with their passkey, once the
   * shop has one); from an agent it waits for the owner like any policy change. The suggestion is
   * recomputed here, never taken from the caller.
   */
  async adoptSuggestion(shopId: string, suggestionId: string, actor: Actor, proof?: PasskeyProof): Promise<GuardRecord> {
    const found = (await this.autonomy(shopId)).suggestions.find((s) => s.id === suggestionId);
    if (!found) throw new HttpError(409, 'That suggestion no longer applies; your rules or decisions have changed since');
    if (actor.type === 'human' && this.deps.passkeys && (await this.deps.passkeys.required(shopId))) {
      await this.deps.passkeys.confirm(shopId, `adopt-rule:${suggestionId}`, proof);
    }
    return this.submitPolicy(found.policy, `${found.title}. ${found.evidence}`, actor);
  }

  /**
   * Ask to replace a shop's rules. Goes through Guard; from an agent it always waits for the owner.
   * It carries the version of the rules it replaces (by default the current ones), so it is refused if
   * they change while it waits.
   */
  async submitPolicy(policy: Policy, reason: string, actor: Actor, base?: string): Promise<GuardRecord> {
    base ??= policyVersion(await this.policy(policy.ownerId));
    return this.deps.guard.submit({ kind: 'policy.update', actor, ownerId: policy.ownerId, reason, params: { policy, base } });
  }

  /**
   * The owner's say-so. Callers must have authenticated the owner of `shopId`. What follows from the
   * decision (charging the order, or releasing it and its stock) happens in Commerce when Guard settles.
   */
  async decide(shopId: string, recordId: string, decision: 'approve' | 'reject', approver: string, options: DecideOptions = {}): Promise<GuardRecord> {
    const { note, proof } = options;
    if (!approver.startsWith('owner:')) throw new HttpError(403, 'Only the owner can decide');
    const record = await this.record(shopId, recordId);
    // The shared public demo session decides refunds and invoices, but the demo's rules stay the same for everyone.
    if (options.shared && decision === 'approve' && record.action.kind === 'policy.update') {
      throw new HttpError(403, "The shared demo shop's rules stay as they are. Start the judges' tour for a shop of your own.");
    }
    // Saying no is always safe; saying yes is signed by the owner's device once they have a passkey.
    let evidence: Record<string, unknown> | undefined;
    if (decision === 'approve' && this.deps.passkeys && (await this.deps.passkeys.required(shopId))) {
      if (!proof) throw new HttpError(428, 'This shop approves with a passkey: confirm with your fingerprint, face or PIN');
      if (record.status !== 'pending_approval') throw new HttpError(409, `Record ${recordId} was already decided`);
      evidence = { passkey: await this.deps.passkeys.signApproval(shopId, record, proof) };
      if (typeof note === 'string' && note) evidence.note = note;
    } else if (decision === 'approve' && note) {
      evidence = { note };
    }
    try {
      return decision === 'approve' ? await this.deps.guard.approve(recordId, approver, evidence) : await this.deps.guard.reject(recordId, approver, note);
    } catch (err) {
      if (err instanceof GuardConflict) throw new HttpError(409, err.message);
      throw err; // anything else is a real failure, not "already decided"
    }
  }
}

export interface DecideOptions {
  /** Saved with the decision. */
  note?: string;
  /** The owner's passkey signature, required to approve once the shop has a passkey. */
  proof?: PasskeyProof;
  /** The shared public demo session, which can't change the demo's rules. */
  shared?: boolean;
}

function audited(record: GuardRecord): AuditedRecord {
  return { ...record, chainIntact: verifyAuditChain(record) };
}
