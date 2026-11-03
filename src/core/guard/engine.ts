// The Guard pipeline: propose -> simulate -> decide -> [say-so] -> execute -> verify, with every step
// appended to a hash-chained audit log. Executors (one per action kind) do the PayPal calls; this file
// only orchestrates, so it is fully testable with fake executors (tests/guard.test.ts).

import { createHash, randomUUID } from 'node:crypto';
import { evaluate, type Policy } from './policy.ts';
import type { ActionKind, AuditEvent, Executor, GuardRecord, GuardStore, ProposedAction } from './types.ts';

const HUMAN_ONLY = new Set<ActionKind>(['policy.update']);

export interface GuardDeps {
  store: GuardStore;
  executors: Partial<Record<ActionKind, Executor>>;
  policyFor: (ownerId: string) => Promise<Policy>;
  /** Called when a record needs a human: push to the dashboard, email, etc. */
  onApprovalNeeded?: (record: GuardRecord) => Promise<void> | void;
  now?: () => Date;
}

export class Guard {
  private readonly deps: GuardDeps;

  constructor(deps: GuardDeps) {
    this.deps = deps;
  }

  /** Entry point for agents. Returns the record; status tells the agent what happened. */
  async submit(action: ProposedAction): Promise<GuardRecord> {
    const executor = this.executor(action.kind);
    const now = this.now();
    const record: GuardRecord = {
      id: `say_${randomUUID().slice(0, 8)}`,
      createdAt: now.toISOString(),
      action,
      status: 'executing',
      idempotencyKey: randomUUID(),
      events: [],
    };
    append(record, 'proposed', action.actor.id, { reason: action.reason }, now);

    // 1. Simulate against live PayPal state before deciding anything.
    record.simulation = await executor.simulate(action).catch((err: unknown) => ({
      ok: false,
      effects: [],
      blockers: [`Simulation failed: ${errorMessage(err)}`],
    }));
    append(record, 'simulated', 'sayso', { ...record.simulation }, this.now());

    // 2. Decide with the owner's policy. A failed simulation is a hard stop: PayPal would reject it.
    const history = await this.deps.store.listSince(action.ownerId, new Date(now.getTime() - 86_400_000));
    const policy = await this.deps.policyFor(action.ownerId);
    record.decision = record.simulation.ok
      ? evaluate(policy, action, history, now)
      : {
          verdict: 'deny',
          hits: record.simulation.blockers.map((message) => ({ ruleId: 'simulation', verdict: 'deny' as const, message })),
        };
    // Built in, not part of any policy: an agent can never change its own rules without the owner.
    if (HUMAN_ONLY.has(action.kind) && action.actor.type === 'agent' && record.decision.verdict === 'allow') {
      record.decision = {
        verdict: 'require_approval',
        hits: [...record.decision.hits, { ruleId: 'built-in:human-only', verdict: 'require_approval', message: 'Agents can propose policy changes, but only the owner can apply them.' }],
      };
    }
    append(record, 'decided', 'sayso', { ...record.decision }, this.now());

    if (record.decision.verdict === 'deny') {
      record.status = 'denied';
      await this.deps.store.insert(record);
      return record;
    }
    if (record.decision.verdict === 'require_approval') {
      record.status = 'pending_approval';
      await this.deps.store.insert(record);
      await this.deps.onApprovalNeeded?.(record);
      return record;
    }

    await this.deps.store.insert(record);
    return this.run(record);
  }

  /** A human gives their say-so. Only pending records can be approved, and only once. */
  async approve(recordId: string, approver: string): Promise<GuardRecord> {
    const record = await this.pending(recordId);
    append(record, 'approved', approver, undefined, this.now());
    record.status = 'executing';
    await this.deps.store.update(record);
    return this.run(record);
  }

  async reject(recordId: string, approver: string, note?: string): Promise<GuardRecord> {
    const record = await this.pending(recordId);
    append(record, 'rejected', approver, note ? { note } : undefined, this.now());
    record.status = 'rejected';
    await this.deps.store.update(record);
    return record;
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
      return record;
    }

    // Never trust a 2xx alone: read the object back from PayPal and check it moved as intended.
    record.verification = await executor.verify(record.action, record.result).catch((err: unknown) => ({
      ok: false,
      detail: `Verification failed: ${errorMessage(err)}`,
    }));
    record.status = record.verification.ok ? 'verified' : 'failed';
    append(record, record.verification.ok ? 'verified' : 'failed', 'sayso', { ...record.verification }, this.now());
    await this.deps.store.update(record);
    return record;
  }

  private async pending(recordId: string): Promise<GuardRecord> {
    const record = await this.deps.store.get(recordId);
    if (!record) throw new Error(`No Guard record ${recordId}`);
    if (record.status !== 'pending_approval') throw new Error(`Record ${recordId} is ${record.status}, not pending approval`);
    return record;
  }

  private executor(kind: ActionKind): Executor {
    const executor = this.deps.executors[kind];
    if (!executor) throw new Error(`No executor registered for ${kind}`);
    return executor;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}

function append(record: GuardRecord, type: AuditEvent['type'], by: string, data: Record<string, unknown> | undefined, at: Date): void {
  const prev = record.events.at(-1)?.hash ?? record.id;
  const body = JSON.stringify({ at: at.toISOString(), type, by, data });
  const hash = createHash('sha256').update(prev).update(body).digest('hex');
  record.events.push({ at: at.toISOString(), type, by, data, hash });
}

/** Recompute the chain; false means an event was edited or removed after the fact. */
export function verifyAuditChain(record: GuardRecord): boolean {
  let prev = record.id;
  for (const e of record.events) {
    const body = JSON.stringify({ at: e.at, type: e.type, by: e.by, data: e.data });
    const hash = createHash('sha256').update(prev).update(body).digest('hex');
    if (hash !== e.hash) return false;
    prev = hash;
  }
  return true;
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
  async get(id: string): Promise<GuardRecord | undefined> {
    const r = this.records.get(id);
    return r && structuredClone(r);
  }
  async listSince(ownerId: string, since: Date): Promise<GuardRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.action.ownerId === ownerId && Date.parse(r.createdAt) >= since.getTime())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => structuredClone(r));
  }
}
