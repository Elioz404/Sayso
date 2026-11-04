// The Guard pipeline: propose -> simulate -> decide -> [say-so] -> execute -> verify, with every step
// appended to a hash-chained audit log. Executors (one per action kind) do the PayPal calls; this file
// only orchestrates, so it is fully testable with fake executors (tests/guard.test.ts).

import { createHash, randomUUID } from 'node:crypto';
import { evaluate, findDuplicate, historyWindowMs, minutesAgo, type Policy } from './policy.ts';
import { matchesQuery } from './types.ts';
import type { ActionKind, AuditEvent, Decision, Executor, GuardRecord, GuardStore, ProposedAction, RecordQuery, RecordStatus, RuleHit, Verdict } from './types.ts';

/** Only a person can apply these, whoever proposes them. */
const HUMAN_ONLY = new Set<ActionKind>(['policy.update']);
/** The same money move twice within this window is a duplicate, whatever the owner's policy says. */
const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** Final states: Guard tells subscribers once a record reaches one of them. */
const SETTLED: readonly RecordStatus[] = ['verified', 'unverified', 'failed', 'denied', 'rejected'];

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
    //    policy plus the built-in rules no policy can switch off.
    const policy = await this.deps.policyFor(action.ownerId);
    const history = await this.deps.store.list(action.ownerId, { since: new Date(now.getTime() - historyWindowMs(policy)) });
    record.decision = record.simulation.ok
      ? withBuiltIns(evaluate(policy, action, history, now), action, history, now)
      : { verdict: 'deny', hits: record.simulation.blockers.map((message) => ({ ruleId: 'simulation', verdict: 'deny' as const, message })) };
    append(record, 'decided', 'sayso', { ...record.decision }, this.now());

    if (record.decision.verdict === 'deny') {
      record.status = 'denied';
      await this.deps.store.insert(record);
      await this.settled(record);
      return record;
    }
    if (record.decision.verdict === 'require_approval') {
      record.status = 'pending_approval';
      await this.deps.store.insert(record);
      if (options.notify !== false) await this.deps.onApprovalNeeded?.(record);
      return record;
    }

    await this.deps.store.insert(record);
    return this.run(record);
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
    try {
      record.result = await executor.execute(record.action, record.idempotencyKey);
      record.status = 'executed';
      append(record, 'executed', 'sayso', record.result, this.now());
    } catch (err) {
      record.status = 'failed';
      append(record, 'failed', 'sayso', { error: errorMessage(err) }, this.now());
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
function withBuiltIns(decision: Decision, action: ProposedAction, history: GuardRecord[], now: Date): Decision {
  const hits: RuleHit[] = [...decision.hits];
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
