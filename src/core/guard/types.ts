// Sayso Guard: every money-moving action an AI agent wants to take goes through
//   propose -> simulate -> decide (policy) -> [human say-so] -> execute -> verify -> audit.
// These are the shared types. Amounts are integer minor units.

export type ActionKind =
  | 'checkout.create' // buyer agent opens a PayPal checkout for a cart
  | 'payment.capture' // merchant captures an authorized payment
  | 'payment.void' // merchant releases an authorization (buyer is never charged)
  | 'refund.create'
  | 'invoice.send'
  | 'dispute.accept';

export type Side = 'buyer' | 'merchant';

export interface Actor {
  type: 'agent' | 'human';
  id: string; // e.g. "buyer-agent:chatgpt", "ops-agent", "owner:maya"
  side: Side;
}

export interface ProposedAction {
  kind: ActionKind;
  actor: Actor;
  /** Shop or buyer account the action belongs to; policies are looked up per owner. */
  ownerId: string;
  amount?: number;
  currency?: string;
  /** Who receives money or the document: buyer email, merchant id... */
  counterparty?: string;
  /** PayPal object acted on: order id, authorization id, capture id, dispute id... */
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
  | 'failed';

export interface AuditEvent {
  at: string; // ISO timestamp
  type: 'proposed' | 'simulated' | 'decided' | 'approved' | 'rejected' | 'executed' | 'verified' | 'failed';
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

export interface GuardStore {
  insert(record: GuardRecord): Promise<void>;
  update(record: GuardRecord): Promise<void>;
  get(id: string): Promise<GuardRecord | undefined>;
  /** Records of an owner created at or after `since`, newest first. */
  listSince(ownerId: string, since: Date): Promise<GuardRecord[]>;
}
