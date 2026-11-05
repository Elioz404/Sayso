import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Guard, MemoryGuardStore, verifyAuditChain } from '../src/core/guard/engine.ts';
import { defaultBuyerPolicy, defaultMerchantPolicy, evaluate, type Policy } from '../src/core/guard/policy.ts';
import type { Executor, GuardRecord, ProposedAction } from '../src/core/guard/types.ts';
import { toMinor, toMoney } from '../src/core/money.ts';

const opsAgent = { type: 'agent' as const, id: 'ops-agent', side: 'merchant' as const };

function refund(amount: number, resourceId = 'CAP-1'): ProposedAction {
  return { kind: 'refund.create', actor: opsAgent, ownerId: 'shop_maya', amount, currency: 'USD', resourceId, reason: 'Arrived chipped', params: { orderId: 'ORD-1' } };
}

/** Fake PayPal: one $60 capture; tracks refunds so simulation sees earlier ones. */
function fakeRefunds(calls: string[]): Executor {
  let refunded = 0;
  return {
    async simulate(action) {
      const refundable = 6_000 - refunded;
      const ok = (action.amount ?? 0) <= refundable;
      return { ok, effects: [`Refund ${action.amount}`], blockers: ok ? [] : ['exceeds refundable'] };
    },
    async execute(action, key) {
      calls.push(key);
      refunded += action.amount ?? 0;
      return { refund_id: `REF-${calls.length}` };
    },
    async verify() {
      return { ok: true, detail: 'COMPLETED' };
    },
  };
}

function setup(policy: Policy = defaultMerchantPolicy('shop_maya', 'USD')) {
  const calls: string[] = [];
  const approvals: GuardRecord[] = [];
  const guard = new Guard({
    store: new MemoryGuardStore(),
    executors: { 'refund.create': fakeRefunds(calls) },
    policyFor: async () => policy,
    onApprovalNeeded: (r) => {
      approvals.push(r);
    },
  });
  return { guard, calls, approvals };
}

test('small refund runs straight through and is verified', async () => {
  const { guard, calls } = setup();
  const r = await guard.submit(refund(2_000));
  assert.equal(r.status, 'verified');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], r.idempotencyKey); // PayPal-Request-Id is the record's key
  assert.deepEqual(r.events.map((e) => e.type), ['proposed', 'simulated', 'decided', 'executed', 'verified']);
  assert.ok(verifyAuditChain(r));
});

test('refund over $50 waits for the owner, then executes on approval', async () => {
  const { guard, calls, approvals } = setup();
  const r = await guard.submit(refund(5_500));
  assert.equal(r.status, 'pending_approval');
  assert.equal(calls.length, 0);
  assert.equal(approvals.length, 1);
  assert.match(r.decision!.hits[0].message, /over the \$50\.00 limit/);

  const done = await guard.approve(r.id, 'owner:maya');
  assert.equal(done.status, 'verified');
  assert.equal(calls.length, 1);
  assert.ok(done.events.some((e) => e.type === 'approved' && e.by === 'owner:maya'));
  await assert.rejects(guard.approve(r.id, 'owner:maya'), /not pending/);
});

test('the same refund twice within an hour is denied as a duplicate', async () => {
  const { guard, calls } = setup();
  await guard.submit(refund(1_500));
  const second = await guard.submit(refund(1_500));
  assert.equal(second.status, 'denied');
  assert.match(second.decision!.hits[0].message, /duplicate/);
  assert.equal(calls.length, 1);
});

test('simulation blockers deny before PayPal is called', async () => {
  const { guard, calls } = setup({ ownerId: 'shop_maya', currency: 'USD', rules: [] });
  const r = await guard.submit(refund(9_000));
  assert.equal(r.status, 'denied');
  assert.equal(r.decision!.hits[0].ruleId, 'simulation');
  assert.equal(calls.length, 0);
});

test('rejected records never execute', async () => {
  const { guard, calls } = setup();
  const r = await guard.submit(refund(5_500));
  const rejected = await guard.reject(r.id, 'owner:maya', 'Ask for a photo first');
  assert.equal(rejected.status, 'rejected');
  assert.equal(calls.length, 0);
});

test('tampering with an audit event breaks the chain', async () => {
  const { guard } = setup();
  const r = await guard.submit(refund(2_000));
  r.events[1].data = { effects: ['something else'] };
  assert.equal(verifyAuditChain(r), false);
});

test('the audit chain survives storage that reorders JSON keys (Postgres jsonb)', async () => {
  const { guard } = setup();
  const r = await guard.submit(refund(2_000));
  const reorder = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
  const roundTripped = reorder(JSON.parse(JSON.stringify(r))) as GuardRecord;
  assert.notEqual(JSON.stringify(roundTripped.events[1]), JSON.stringify(r.events[1]), 'keys really were reordered');
  assert.equal(verifyAuditChain(roundTripped), true);
});

test('buyer mandate: daily total escalates even when each order is small', () => {
  const policy = defaultBuyerPolicy('buyer_1', 'USD');
  const buyerAgent = { type: 'agent' as const, id: 'buyer-agent', side: 'buyer' as const };
  const now = new Date('2026-11-10T12:00:00Z');
  const past = (amount: number, minutesAgo: number): GuardRecord => ({
    id: `say_${amount}`,
    createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    action: { kind: 'checkout.create', actor: buyerAgent, ownerId: 'buyer_1', amount, currency: 'USD', reason: 'x', resourceId: `cart_${amount}` },
    status: 'verified',
    idempotencyKey: 'k',
    events: [],
  });
  const history = [past(9_000, 120), past(9_500, 60)];
  const d = evaluate(policy, { ...history[0].action, amount: 8_000, resourceId: 'cart_new' }, history, now);
  assert.equal(d.verdict, 'require_approval');
  assert.match(d.hits[0].message, /\$265\.00/);
});

test('money round-trips through PayPal decimal strings', () => {
  for (const minor of [0, 5, 99, 100, 3_400, 123_456]) assert.equal(toMinor(toMoney(minor, 'USD')), minor);
  assert.equal(toMoney(1500, 'JPY').value, '1500');
  assert.throws(() => toMinor({ currency_code: 'USD', value: '1.234' }));
});

/** An executor whose first calls fail the way the network or PayPal can, then (maybe) succeed. */
function flaky(failures: unknown[], keys: string[]): Executor {
  return {
    async simulate() {
      return { ok: true, effects: ['Refund'], blockers: [] };
    },
    async execute(_action, key) {
      keys.push(key);
      const failure = failures.shift();
      if (failure) throw failure;
      return { refund_id: 'REF-1' };
    },
    async verify() {
      return { ok: true, detail: 'COMPLETED' };
    },
  };
}

const guardWith = (executor: Executor) => new Guard({ store: new MemoryGuardStore(), executors: { 'refund.create': executor }, policyFor: async () => defaultMerchantPolicy('shop_maya', 'USD') });
const httpError = (status: number) => Object.assign(new Error(`PayPal ${status}`), { status });

test('a lost answer is retried with the same key; still unknown, it is unverified, never failed', async () => {
  const timeout = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
  const keys: string[] = [];
  const replayed = await guardWith(flaky([timeout], keys)).submit(refund(1_000));
  assert.equal(replayed.status, 'verified');
  assert.equal(new Set(keys).size, 1, 'the retry carries the same PayPal-Request-Id');

  const unknown = await guardWith(flaky([httpError(503), httpError(502)], [])).submit(refund(1_000));
  assert.equal(unknown.status, 'unverified', 'it may have gone through: an order is not released over it');
  assert.match(unknown.verification!.detail, /may have gone through/);

  const refused = await guardWith(flaky([httpError(422)], [])).submit(refund(1_000));
  assert.equal(refused.status, 'failed', 'a clear refusal means nothing moved');
});

test('two requests at once still count each other against a daily total', async () => {
  const policy: Policy = { ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'day', type: 'daily_total', kinds: ['refund.create'], limit: 5_000, then: 'require_approval' }] };
  const { guard } = setup(policy);
  // $30 + $30 > $50 a day: whichever is decided second must wait, even when both arrive together.
  const [a, b] = await Promise.all([guard.submit(refund(3_000, 'CAP-A')), guard.submit(refund(3_000, 'CAP-B'))]);
  assert.deepEqual([a.status, b.status].sort(), ['pending_approval', 'verified']);
});

test("letting go of a buyer's hold is never held by the owner's rules", async () => {
  const { OPS_AGENT } = await import('../src/core/actors.ts');
  const policy: Policy = { ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'no-voids', type: 'never', kinds: ['payment.void'] }] };
  const voids: Executor = { simulate: async () => ({ ok: true, effects: ['Release'], blockers: [] }), execute: async () => ({ ok: true }), verify: async () => ({ ok: true, detail: 'VOIDED' }) };
  const guard = new Guard({ store: new MemoryGuardStore(), executors: { 'payment.void': voids }, policyFor: async () => policy });
  const release = await guard.submit({ kind: 'payment.void', actor: OPS_AGENT, ownerId: 'shop_maya', resourceId: 'AUTH-1', reason: 'Order released' });
  assert.equal(release.status, 'verified', "the buyer's money is not kept on hold");
  const agentVoid = await guard.submit({ kind: 'payment.void', actor: opsAgent, ownerId: 'shop_maya', resourceId: 'AUTH-2', reason: 'Agent' });
  assert.equal(agentVoid.status, 'denied', "an agent's void still follows the rules");
});
