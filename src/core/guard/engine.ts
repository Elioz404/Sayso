// The Guard pipeline: propose -> simulate -> decide -> [say-so] -> execute -> verify, with every step
// appended to a hash-chained audit log. Executors (one per action kind) do the PayPal calls; this file
// only orchestrates, so it is fully testable with fake executors (tests/guard.test.ts).

import { createHash, randomUUID } from 'node:crypto';
import { OPS_AGENT } from '../actors.ts';
import { KeyedLock } from '../lock.ts';
import { evaluate, findDuplicate, historyWindowMs, minutesAgo, type Policy } from './policy.ts';
import { matchesQuery, SPENDING_STATUSES } from './types.ts';
import type { ActionKind, AuditEvent, Decision, Executor, GuardRecord, GuardStore, ProposedAction, RecordQuery, RecordStatus, RuleHit, Verdict } from './types.ts';

/** Only a person can apply these, whoever proposes them. */
const HUMAN_ONLY = new Set<ActionKind>(['policy.update']);
/** The same money move twice within this window is a duplicate, whatever the owner's policy says. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** Final states: Guard tells subscribers once a record reaches one of them. */
const SETTLED: readonly RecordStatus[] = ['verified', 'unverified', 'failed', 'denied', 'rejected'];
/**
 * Most records a decision reads. Rules only count what is (or may be) spent, so that is all that is
 * read; a shop busier than this in one window gets the owner's eyes instead of a guess.
 */
const HISTORY_LIMIT = 2_000;

export interface SubmitOptions {
  /** A deterministic PayPal-Request-Id (e.g. "<cart>-capture"), so a retry anywhere replays instead of repeating. */
  idempotencyKey?: string;
  /** Tell the owner when the action waits for them. Default true. */
  notify?: boolean;
}

export type SettledListener = (record: GuardRecord) => Promise<void> | void;

/** The record can't be decided now: it isn't waiting for a decision (any more). */
export class GuardConflict extends Error {}

export interface GuardDeps {
  store: GuardStore;
  executors?: Partial<Record<ActionKind, Executor>>;
  policyFor: (ownerId: string) => Promise<Policy>;
  /** Called when a record needs a human: push to the owner's phone, the dashboard... */
  onApprovalNeeded?: (record: GuardRecord) => Promise<void> | void;
  now?: () => Date;
}

export class Guard {
  private readonly deps: GuardDeps;
  private readonly executors: Partial<Record<ActionKind, Executor>>;
  private readonly listeners: SettledListener[] = [];
  private readonly deciding = new KeyedLock();

  constructor(deps: GuardDeps) {
    this.deps = deps;
    this.executors = { ...deps.executors };
  }

  /** Add how Guard performs one kind of action (lets executors that need Guard's callers be wired later). */
  register(kind: ActionKind, executor: Executor): void {
    this.executors[kind] = executor;
  }

  /** Run `listener` whenever a record reaches a final state, e.g. to keep an order in step with its capture. */
  subscribe(listener: SettledListener): void {
    this.listeners.push(listener);
  }

  /** Entry point for agents. Returns the record; its status tells the caller what happened. */
  async submit(action: ProposedAction, options: SubmitOptions = {}): Promise<GuardRecord> {
    const executor = this.executor(action.kind);
    const now = this.now();
    const record: GuardRecord = {
      id: `say_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      createdAt: now.toISOString(),
      action,
      status: 'executing',
      idempotencyKey: options.idempotencyKey ?? randomUUID(),
      events: [],
    };
    append(record, 'proposed', action.actor.id, { reason: action.reason }, now);

    // 1. Simulate against live PayPal state before deciding anything.
    record.simulation = await executor.simulate(action).catch((err: unknown) => ({
      ok: false,
      effects: [],
      blockers: [`Simulation failed: ${errorMessage(err)}`],
    }));
    // Rules judge what will really move: "refund everything" is judged at the refundable amount.
    if (action.amount === undefined && record.simulation.amount !== undefined) action.amount = record.simulation.amount;
    append(record, 'simulated', 'sayso', { ...record.simulation }, this.now());

    // 2. Decide: a failed simulation is a hard stop (PayPal would reject it); otherwise the owner's
    //    policy plus the built-in rules no policy can switch off. Reading what was already spent and
    //    saving this record happen as one step per owner, so two requests at once can't both fit under
    //    a daily total or both pass the duplicate check.
    const policy = await this.deps.policyFor(action.ownerId);
    await this.serialize(action.ownerId, async () => {
      const history = await this.deps.store.list(action.ownerId, { since: new Date(now.getTime() - historyWindowMs(policy)), status: SPENDING_STATUSES, limit: HISTORY_LIMIT });
      record.decision = !record.simulation!.ok
        ? { verdict: 'deny', hits: record.simulation!.blockers.map((message) => ({ ruleId: 'simulation', verdict: 'deny' as const, message })) }
        : releasesHold(action)
          ? { verdict: 'allow', hits: [] }
          : withBuiltIns(evaluate(policy, action, history, now), action, history, now, history.length >= HISTORY_LIMIT);
      append(record, 'decided', 'sayso', { ...record.decision }, this.now());
      record.status = record.decision.verdict === 'deny' ? 'denied' : record.decision.verdict === 'require_approval' ? 'pending_approval' : 'executing';
      await this.deps.store.insert(record);
    });

    if (record.status === 'denied') {
      await this.settled(record);
      return record;
    }
    if (record.status === 'pending_approval') {
      if (options.notify !== false) await this.deps.onApprovalNeeded?.(record);
      return record;
    }
    return this.run(record);
  }

  /** One decision at a time per owner: across instances when the store can lock, in this process anyway. */
  private serialize<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
    return this.deciding.run(ownerId, () => (this.deps.store.exclusive ? this.deps.store.exclusive(ownerId, work) : work()));
  }

  /**
   * A person gives their say-so. Only pending records can be approved, and only once. `evidence` (a
   * passkey signature, say) is kept in the "approved" event, inside the hash chain.
   */
  async approve(recordId: string, approver: string, evidence?: Record<string, unknown>): Promise<GuardRecord> {
    const record = await this.pending(recordId);
    append(record, 'approved', approver, evidence, this.now());
    record.status = 'executing';
    if (!(await this.deps.store.updateIf(record, 'pending_approval'))) throw new GuardConflict(`Record ${recordId} was already decided`);
    return this.run(record);
  }

  async reject(recordId: string, approver: string, note?: string): Promise<GuardRecord> {
    const record = await this.pending(recordId);
    append(record, 'rejected', approver, note ? { note } : undefined, this.now());
    record.status = 'rejected';
    if (!(await this.deps.store.updateIf(record, 'pending_approval'))) throw new GuardConflict(`Record ${recordId} was already decided`);
    await this.settled(record);
    return record;
  }

  get(recordId: string): Promise<GuardRecord | undefined> {
    return this.deps.store.get(recordId);
  }

  list(ownerId: string, query?: RecordQuery): Promise<GuardRecord[]> {
    return this.deps.store.list(ownerId, query);
  }

  private async run(record: GuardRecord): Promise<GuardRecord> {
    const executor = this.executor(record.action.kind);
    const outcome = await this.execute(executor, record);
    if ('result' in outcome) {
      record.result = outcome.result;
      record.status = 'executed';
      append(record, 'executed', 'sayso', record.result, this.now());
    } else {
      // Refused: nothing moved. Unknown: PayPal may have done it, so it is never called "failed" (that
      // would release an order that was in fact charged); it stays "unverified" for the owner to check.
      record.status = outcome.refused ? 'failed' : 'unverified';
      if (!outcome.refused) record.verification = { ok: false, detail: `PayPal did not answer clearly, so it may have gone through: ${outcome.error}` };
      append(record, outcome.refused ? 'failed' : 'unverified', 'sayso', { error: outcome.error }, this.now());
      await this.deps.store.update(record);
      await this.settled(record);
      return record;
    }

    // Never trust a 2xx alone: read the object back from PayPal and check it moved as intended. If the
    // read-back itself breaks, the money may still have moved: that is "unverified", not "failed".
    try {
      record.verification = await executor.verify(record.action, record.result);
      record.status = record.verification.ok ? 'verified' : 'failed';
    } catch (err) {
      record.verification = { ok: false, detail: `PayPal accepted it, but reading it back failed: ${errorMessage(err)}` };
      record.status = 'unverified';
    }
    append(record, record.status === 'verified' ? 'verified' : record.status === 'unverified' ? 'unverified' : 'failed', 'sayso', { ...record.verification }, this.now());
    await this.deps.store.update(record);
    await this.settled(record);
    return record;
  }

  /**
   * Execute once, and once more with the same idempotency key if the answer was lost (a timeout, a
   * dropped connection, a 5xx): PayPal replays the first result instead of doing it twice.
   */
  private async execute(executor: Executor, record: GuardRecord): Promise<{ result: Record<string, unknown> } | { refused: boolean; error: string }> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { result: await executor.execute(record.action, record.idempotencyKey) };
      } catch (err) {
        if (!ambiguous(err)) return { refused: true, error: errorMessage(err) };
        last = err;
      }
    }
    return { refused: false, error: errorMessage(last) };
  }

  private async settled(record: GuardRecord): Promise<void> {
    if (!SETTLED.includes(record.status)) return;
    for (const listener of this.listeners) await listener(record);
  }

  private async pending(recordId: string): Promise<GuardRecord> {
    const record = await this.deps.store.get(recordId);
    if (!record) throw new GuardConflict(`No Guard record ${recordId}`);
    if (record.status !== 'pending_approval') throw new GuardConflict(`Record ${recordId} is ${record.status}, not pending approval`);
    return record;
  }

  private executor(kind: ActionKind): Executor {
    const executor = this.executors[kind];
    if (!executor) throw new Error(`No executor registered for ${kind}`);
    return executor;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

const SEVERITY: Record<Verdict, number> = { allow: 0, require_approval: 1, deny: 2 };

/**
 * Rules that are part of Guard, not of any policy: an agent can never change its own rules, the buyer's
 * side can never move the shop's money on its own, and the same money move twice is refused.
 */
function withBuiltIns(decision: Decision, action: ProposedAction, history: GuardRecord[], now: Date, historyCut: boolean): Decision {
  const hits: RuleHit[] = [...decision.hits];
  if (historyCut) {
    hits.push({ ruleId: 'built-in:busy', verdict: 'require_approval', message: 'There is more recent activity than Guard reads at once, so limits could not be checked in full. You decide.' });
  }
  if (HUMAN_ONLY.has(action.kind) && action.actor.type === 'agent') {
    hits.push({ ruleId: 'built-in:human-only', verdict: 'require_approval', message: 'Agents can propose policy changes, but only the owner can apply them.' });
  }
  if (action.actor.side === 'buyer' && action.kind === 'refund.create') {
    hits.push({ ruleId: 'built-in:buyer-request', verdict: 'require_approval', message: "The buyer's assistant asked for this refund. Only you decide." });
  }
  if (!HUMAN_ONLY.has(action.kind) && !hits.some((h) => h.verdict === 'deny')) {
    const dup = findDuplicate(action, history, now.getTime() - DUPLICATE_WINDOW_MS);
    if (dup) hits.push({ ruleId: 'built-in:duplicate', verdict: 'deny', message: `Looks like a repeat of ${dup.id} from ${minutesAgo(dup.createdAt, now)} min ago.` });
  }
  const verdict = hits.reduce<Verdict>((worst, h) => (SEVERITY[h.verdict] > SEVERITY[worst] ? h.verdict : worst), 'allow');
  return { verdict, hits };
}

function append(record: GuardRecord, type: AuditEvent['type'], by: string, data: Record<string, unknown> | undefined, at: Date): void {
  const prev = record.events.at(-1)?.hash ?? record.id;
  const body = canonicalJson({ at: at.toISOString(), type, by, data });
  const hash = createHash('sha256').update(prev).update(body).digest('hex');
  record.events.push({ at: at.toISOString(), type, by, data, hash });
}

/** Recompute the chain; false means an event was edited or removed after the fact. */
export function verifyAuditChain(record: GuardRecord): boolean {
  let prev = record.id;
  for (const e of record.events) {
    const body = canonicalJson({ at: e.at, type: e.type, by: e.by, data: e.data });
    const hash = createHash('sha256').update(prev).update(body).digest('hex');
    if (hash !== e.hash) return false;
    prev = hash;
  }
  return true;
}

/**
 * JSON with object keys sorted at every level, so a record hashes the same after a round-trip through
 * storage that reorders keys (Postgres jsonb does).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** In-memory store for tests and local demos. Production uses the Postgres store. */
export class MemoryGuardStore implements GuardStore {
  private readonly records = new Map<string, GuardRecord>();

  async insert(record: GuardRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }
  async update(record: GuardRecord): Promise<void> {
    this.records.set(record.id, structuredClone(record));
  }
  async updateIf(record: GuardRecord, expected: RecordStatus): Promise<boolean> {
    if (this.records.get(record.id)?.status !== expected) return false;
    this.records.set(record.id, structuredClone(record));
    return true;
  }
  async get(id: string): Promise<GuardRecord | undefined> {
    const r = this.records.get(id);
    return r && structuredClone(r);
  }
  async list(ownerId: string, query: RecordQuery = {}): Promise<GuardRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.action.ownerId === ownerId && matchesQuery(r, query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, query.limit ?? Infinity)
      .map((r) => structuredClone(r));
  }
}

/**
 * The call may or may not have gone through: no answer (timeout, network) or a server-side error. A clear
 * refusal (any other 4xx, or an executor's own check) means nothing moved.
 */
function ambiguous(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status >= 500 || status === 408 || status === 409;
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError' || (err instanceof TypeError && /fetch|network|socket/i.test(err.message));
}

/**
 * Sayso letting go of a buyer's payment hold (an order that won't go through) gives money back to the
 * buyer: it is not the owner's money moving, so the owner's rules don't hold it. It is still recorded.
 */
function releasesHold(action: ProposedAction): boolean {
  return action.kind === 'payment.void' && action.actor.id === OPS_AGENT.id;
}
