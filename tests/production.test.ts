// The made-to-order board: PayPal payments gate the making, plans can move, money can't.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { address, stack } from './stack.ts';

type Stack = Awaited<ReturnType<typeof stack>>;

async function board(s: Stack) {
  return (await s.call('production_board', {}, s.owner)).data as { job_id: string; what: string; payment: string; making: string; blocked_by_payment: boolean }[];
}

test('a paid made-to-order item goes on the board, planned from the day it was paid', async () => {
  const s = await stack();
  const cart = await s.call('create_cart', { items: [{ variant_id: 'var_vase_custom', quantity: 1 }, { variant_id: 'var_mug_sage', quantity: 1 }], shipping_address: address }, s.buyer);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  await s.commerce.checkout(cart.data.cart_id, { items: [], payment_method: { type: 'paypal', token } });

  const jobs = await board(s);
  assert.equal(jobs.length, 1, 'only the made-to-order vase, not the mug from stock');
  assert.match(jobs[0].what, /Custom Bud Vase/);
  assert.equal(jobs[0].blocked_by_payment, false);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const in10 = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  assert.equal(jobs[0].making, `${tomorrow} to ${in10}`, 'starts the day after payment, for the variant lead time of 10 days');
});

test('a commission waits on its deposit, then the owner\'s agent can plan it', async () => {
  const s = await stack();
  const sent = await s.call('send_invoice', { email: 'grace@example.com', name: 'Grace', items: [{ name: 'Cobalt vase', price: '40.00' }], deposit: '20.00', make_days: 12 }, s.owner);
  await s.saySo.decide('shop_maya', sent.data.say_so_id, 'approve', 'owner:shop_maya'); // first invoice to Grace

  let [job] = await board(s);
  assert.equal(job.blocked_by_payment, true);
  assert.match(job.payment, /waiting for \$40\.00/);

  const [invoice] = [...s.pp.invoices.values()];
  s.pp.payInvoice(invoice.id, 'deposit');
  [job] = await board(s);
  assert.equal(job.blocked_by_payment, false);
  assert.match(job.payment, /^deposit/);

  const planned = await s.call('plan_job', { job_id: job.job_id, start: '2026-11-20', end: '2026-12-02' }, s.owner);
  assert.deepEqual(planned.data.making, { start: '2026-11-20', end: '2026-12-02', by: 'owner' });
  const bad = await s.call('plan_job', { job_id: job.job_id, start: '2026-12-02', end: '2026-11-20' }, s.owner);
  assert.equal(bad.isError, true);
  const unknown = await s.call('plan_job', { job_id: 'invoice:nope', start: '2026-11-20', end: '2026-11-21' }, s.owner);
  assert.match(unknown.text, /not found/);
  assert.equal((await s.call('plan_job', { job_id: job.job_id, start: '2026-11-20', end: '2026-11-21' }, s.buyer)).isError, true, 'buyers cannot plan');
});
