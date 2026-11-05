// What every Guard store must do with a query, whatever keeps the records: newest first, exactly the
// filters asked for, and never more (or, silently, fewer) than the limit. The memory store runs here; the
// Postgres store builds the same filters in SQL (src/server/pg-stores.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryGuardStore } from '../src/core/guard/engine.ts';
import type { GuardRecord, GuardStore } from '../src/core/guard/types.ts';

function record(n: number, extra: { kind?: GuardRecord['action']['kind']; status?: GuardRecord['status']; cartId?: string; counterparty?: string; answered?: boolean } = {}): GuardRecord {
  const at = new Date(Date.UTC(2026, 10, 1, 12, n)).toISOString();
  return {
    id: `rec_${n}`,
    createdAt: at,
    action: {
      kind: extra.kind ?? 'refund.create',
      actor: { type: 'agent', id: 'agent:a:k', side: 'merchant' },
      ownerId: 'shop_x',
      reason: 'r',
      ...(extra.counterparty ? { counterparty: extra.counterparty } : {}),
      params: extra.cartId ? { cartId: extra.cartId } : {},
    },
    status: extra.status ?? 'verified',
    idempotencyKey: `k${n}`,
    events: extra.answered ? [{ at, type: 'approved', by: 'owner:shop_x', hash: 'h' }] : [],
  };
}

async function contract(store: GuardStore) {
  const rows = [
    record(1, { cartId: 'c1' }),
    record(2, { cartId: 'c2', status: 'pending_approval' }),
    record(3, { kind: 'invoice.send', counterparty: 'ana@example.com' }),
    record(4, { cartId: 'c1', answered: true }),
    record(5, { kind: 'invoice.send', counterparty: 'bo@example.com', status: 'unverified' }),
  ];
  for (const r of rows) await store.insert(r);
  await store.insert({ ...record(6), action: { ...record(6).action, ownerId: 'shop_other' } });
  const ids = async (query: Parameters<GuardStore['list']>[1]) => (await store.list('shop_x', query)).map((r) => r.id);

  assert.deepEqual(await ids({ limit: 10 }), ['rec_5', 'rec_4', 'rec_3', 'rec_2', 'rec_1'], 'newest first, one owner only');
  assert.deepEqual(await ids({ limit: 2 }), ['rec_5', 'rec_4'], 'the limit, exactly');
  assert.deepEqual(await ids({ cartIds: ['c1', 'c2'], limit: 10 }), ['rec_4', 'rec_2', 'rec_1']);
  assert.deepEqual(await ids({ cartId: 'c1', status: 'verified', limit: 10 }), ['rec_4', 'rec_1']);
  assert.deepEqual(await ids({ status: ['verified', 'unverified'], kind: 'invoice.send', limit: 10 }), ['rec_5', 'rec_3']);
  assert.deepEqual(await ids({ counterparty: 'ana@example.com', limit: 10 }), ['rec_3']);
  assert.deepEqual(await ids({ answered: true, limit: 10 }), ['rec_4']);
  assert.deepEqual(await ids({ since: new Date(rows[3].createdAt), limit: 10 }), ['rec_5', 'rec_4']);
}

test('the memory Guard store keeps the contract', () => contract(new MemoryGuardStore()));
