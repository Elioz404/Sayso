// Sayso Guard: every money-moving action an AI agent wants to take goes through
//   propose -> simulate -> decide (policy) -> [human say-so] -> execute -> verify -> audit.
// These are the shared types. Amounts are integer minor units.

/** Every action Guard governs, with how it reads to people. The single list the rest derives from. */
export const ACTIONS = {
  'checkout.create': { label: 'Purchase', noun: 'purchases' }, // a buyer's assistant pays with saved PayPal
  'payment.capture': { label: 'Charge an order', noun: 'payment captures' },
  'payment.void': { label: 'Release a payment hold', noun: 'authorization voids' },
  'refund.create': { label: 'Refund', noun: 'refunds' },
  'invoice.send': { label: 'Send an invoice', noun: 'invoices' },
  'policy.update': { label: 'Change your rules', noun: 'policy changes' }, // never on an agent's word alone
} as const;

export type ActionKind = keyof typeof ACTIONS;
export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[];

export type Side = 'buyer' | 'merchant';

export interface Actor {
  type: 'agent' | 'human';
  /** "agent:<label>:<key id>", "buyer-agent:<channel>", "owner:<shop id>" or a system actor. */
  id: string;
  side: Side;
  /** The owner's agent key it acted with, and that key's label (see agentActor). */
  keyId?: string;
  label?: string;
  /** A buyer's assistant: where it shopped from ("mcp", "sayso-assistant"). */
  channel?: string;
}

export interface ProposedAction {
  kind: ActionKind;
  actor: Actor;
  /** Shop or buyer wallet the action belongs to; policies are looked up per owner. */
  ownerId: string;
  /** Leave out to let the simulation work it out (e.g. "refund everything still refundable"). */
  amount?: number;
  currency?: string;
  /** Who receives money or the document: buyer email, merchant id... */
  counterparty?: string;
  /** What is acted on: authorization id, capture id, cart id, recipient email... */
  resourceId?: string;
  /** Free-form category, e.g. product category for buyer mandates. */
  category?: string;
  /** The agent's own explanation, shown to the human who approves. */
  reason: string;
  params?: Record<string, unknown>;
}

export type Verdict = 'allow' | 'require_approval' | 'deny';

export interface RuleHit {
  ruleId: string;
  verdict: Verdict;
  message: string;
}

export interface Decision {
  verdict: Verdict;
  hits: RuleHit[];
}

/** What would happen, computed before anything is executed. */
export interface Simulation {
  ok: boolean;
  /** Plain-language effects, e.g. "Refund $45.00 of $60.00; $15.00 stays captured". */
  effects: string[];
  /** Problems PayPal would reject the call for, caught before calling it. */
  blockers: string[];
  /** The amount the action will actually move, when the proposal left it out. Rules judge this. */
  amount?: number;
  /** Live state read from PayPal while simulating (capture totals, order status...). */
  observed?: Record<string, unknown>;
}

export interface Verification {
  ok: boolean;
  detail: string;
  observed?: Record<string, unknown>;
}

export type RecordStatus =
  | 'pending_approval'
  | 'denied'
  | 'rejected'
  | 'executing'
  | 'executed'
  | 'verified'
  /** PayPal accepted the call but reading it back failed: money may have moved, so never "nothing happened". */
  | 'unverified'
  | 'failed';

/** Statuses where money moved or may move: they count toward limits and duplicate checks. */
export const SPENDING_STATUSES: readonly RecordStatus[] = ['pending_approval', 'executing', 'executed', 'verified', 'unverified'];

/** A record whose money was let go before it was charged: kept in the audit trail, no longer counted. */
export function isReleased(record: GuardRecord): boolean {
  return record.events.some((e) => e.type === 'released');
}

export interface AuditEvent {
  at: string; // ISO timestamp
  /** `released`: what a verified record authorized was let go before it was charged (see Guard.markReleased). */
  type: 'proposed' | 'simulated' | 'decided' | 'approved' | 'rejected' | 'executed' | 'verified' | 'unverified' | 'failed' | 'released';
  by: string;
  data?: Record<string, unknown>;
  /** sha256(prevHash + this event) — a tamper-evident chain per record. */
  hash: string;
}

export interface GuardRecord {
  id: string;
  createdAt: string;
  action: ProposedAction;
  simulation?: Simulation;
  decision?: Decision;
  status: RecordStatus;
  /** Sent as PayPal-Request-Id, so retrying the same record can never double-charge or double-refund. */
  idempotencyKey: string;
  result?: Record<string, unknown>;
  verification?: Verification;
  events: AuditEvent[];
}

/** How Guard performs one kind of action against PayPal. */
export interface Executor {
  simulate(action: ProposedAction): Promise<Simulation>;
  execute(action: ProposedAction, idempotencyKey: string): Promise<Record<string, unknown>>;
  verify(action: ProposedAction, result: Record<string, unknown>): Promise<Verification>;
}

export interface RecordQuery {
  since?: Date;
  status?: RecordStatus | readonly RecordStatus[];
  kind?: ActionKind;
  /** Records about one cart (action.params.cartId). */
  cartId?: string;
  /** Records about any of these carts: an order list's history in one read. */
  cartIds?: readonly string[];
  /** Only actions toward this counterparty (an invoice's recipient, say). */
  counterparty?: string;
  /** Only records the owner answered (approved or rejected). */
  answered?: boolean;
  /** The most records to read, newest first. Every read says how many, so no store cuts it short unasked. */
  limit: number;
}

export interface GuardStore {
  /** Runs `work` while no other instance decides for this owner (a database lock); optional for one-process stores. */
  exclusive?<T>(ownerId: string, work: () => Promise<T>): Promise<T>;
  insert(record: GuardRecord): Promise<void>;
  update(record: GuardRecord): Promise<void>;
  /** Saves only if the stored record is still in `expected` status. False means someone else moved it first. */
  updateIf(record: GuardRecord, expected: RecordStatus): Promise<boolean>;
  get(id: string): Promise<GuardRecord | undefined>;
  /** An owner's records, newest first. */
  list(ownerId: string, query: RecordQuery): Promise<GuardRecord[]>;
}

export function matchesQuery(record: GuardRecord, query: RecordQuery): boolean {
  const statuses = query.status === undefined ? undefined : ([] as RecordStatus[]).concat(query.status);
  return (
    (!query.since || Date.parse(record.createdAt) >= query.since.getTime()) &&
    (!statuses || statuses.includes(record.status)) &&
    (!query.kind || record.action.kind === query.kind) &&
    (!query.cartId || record.action.params?.cartId === query.cartId) &&
    (!query.cartIds || query.cartIds.includes(String(record.action.params?.cartId))) &&
    (!query.counterparty || record.action.counterparty === query.counterparty) &&
    (!query.answered || record.events.some((e) => e.type === 'approved' || e.type === 'rejected'))
  );
}
