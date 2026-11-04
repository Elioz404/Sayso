// The Trust report's rows: every Guard record lands in exactly one outcome, money is counted once, and an
// order's trail says whether PayPal confirmed each move and the audit chain is intact.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { channelName, outcomeOf, trustReport, whoOf } from '../src/core/trust-report.ts';
import { address, stack } from './stack.ts';

test('outcomes and who asked read the way an owner would say them', () => {
  const ev = (type: string) => ({ at: '2026-11-04T00:00:00Z', type, by: 'x', hash: 'h' }) as never;
  assert.equal(outcomeOf({ status: 'verified', events: [ev('proposed')] }), 'Allowed by your rules');
  assert.equal(outcomeOf({ status: 'verified', events: [ev('proposed'), ev('approved')] }), 'You said OK');
  assert.equal(outcomeOf({ status: 'pending_approval', events: [] }), 'Waiting for you');
  assert.equal(outcomeOf({ status: 'rejected', events: [] }), 'You said no');
  assert.equal(outcomeOf({ status: 'denied', events: [] }), 'Blocked by a rule');
  assert.equal(whoOf({ actor: { type: 'agent', id: 'agent:laptop:k1', side: 'merchant' } }), 'Your agents');
  assert.equal(whoOf({ actor: { type: 'agent', id: 'buyer-agent:mcp', side: 'buyer' } }), "Buyers' assistants");
  assert.equal(channelName('sayso-cart'), 'Cart on Sayso');
  assert.equal(channelName('mcp'), 'AI assistants over MCP');
});

test('a real run: a paid order, a small refund the agent made alone, a big one that waits', async () => {
  const s = await stack();
  const cart = (await s.call('create_cart', { items: [{ variant_id: 'var_mug_sage', quantity: 2 }], shipping_address: address }, s.buyer)).data;
  s.pp.approve(new URL(cart.approval_url).searchParams.get('token')!);
  await s.commerce.checkout(cart.cart_id, { items: [], payment_method: { type: 'paypal', token: new URL(cart.approval_url).searchParams.get('token')! } });
  await s.call('refund_order', { order_id: cart.cart_id, amount: '5.00', reason: 'Small chip' }, s.owner);
  await s.call('refund_order', { order_id: cart.cart_id, amount: '60.00', reason: 'Both arrived cracked' }, s.owner);

  const shopId = s.owner.agent!.shopId;
  const records = await s.saySo.audit(shopId, 100);
  const report = trustReport(records, await s.orders.list(shopId), 'USD');

  const refunds = report.decisions.filter((d) => d.action === 'Refund');
  assert.deepEqual(refunds.map((d) => d.outcome).sort(), ['Allowed by your rules', 'Waiting for you']);
  const alone = refunds.find((d) => d.outcome === 'Allowed by your rules')!;
  assert.equal(alone.movedAlone, 5);
  assert.equal(alone.approved + alone.waiting + alone.declined + alone.blocked, 0, 'each amount is counted under one outcome only');
  assert.equal(alone.readBack, 'Read back from PayPal');

  assert.equal(report.sales.length, 1);
  assert.equal(report.sales[0].refunded, 5);
  assert.equal(report.trail[0].chain, 'Intact');
  assert.match(report.trail[0].readBack, /read back from PayPal/);
  assert.ok(report.facts.chainIntact);
});
