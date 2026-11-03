// The made-to-order board: PayPal payments gate the making, plans can move, money can't, and work that
// is cancelled, refunded or made leaves the board.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, dayOf, isDay } from '../src/core/days.ts';
import type { Policy } from '../src/core/guard/policy.ts';
import { address, stack } from './stack.ts';

type Stack = Awaited<ReturnType<typeof stack>>;
type BoardRow = { job_id: string; what: string; payment: string; making: string; blocked: string | false };

async function board(s: Stack): Promise<BoardRow[]> {
  return (await s.call('production_board', {}, s.owner)).data;
}

async function placeOrder(s: Stack, items: { variant_id: string; quantity: number }[]) {
  const cart = await s.call('create_cart', { items, shipping_address: address }, s.buyer);
  const token = new URL(cart.data.approval_url).searchParams.get('token')!;
  s.pp.approve(token);
  return s.commerce.checkout(cart.data.cart_id, { items: [], payment_method: { type: 'paypal', token } });
}

async function sendCommission(s: Stack, email: string, extra: Record<string, unknown> = {}) {
  const sent = await s.call('send_invoice', { email, name: 'Grace', items: [{ name: 'Cobalt vase', price: '40.00' }], make_days: 12, ...extra }, s.owner);
  await s.saySo.decide('shop_maya', sent.data.say_so_id, 'approve', 'owner:shop_maya'); // a first invoice to someone new
  return [...s.pp.invoices.values()].at(-1)!;
}

test('a paid made-to-order item goes on the board, starting the day after it was paid', async () => {
  const s = await stack();
  await placeOrder(s, [{ variant_id: 'var_vase_custom', quantity: 1 }, { variant_id: 'var_mug_sage', quantity: 1 }]);

  const jobs = await board(s);
  assert.equal(jobs.length, 1, 'only the made-to-order vase, not the mug from stock');
  assert.match(jobs[0].what, /Custom Vase/);
  assert.equal(jobs[0].blocked, false);
  const tomorrow = addDays(dayOf(), 1);
  assert.equal(jobs[0].making, `${tomorrow} to ${addDays(tomorrow, 9)}`, 'the variant takes 10 days');
});

test('the same made-to-order item on two lines is two jobs, and the lead time is the one promised', async () => {
  const s = await stack();
  await placeOrder(s, [{ variant_id: 'var_vase_custom', quantity: 1 }, { variant_id: 'var_vase_custom', quantity: 2 }]);
  await s.shops.setVariant('shop_maya', 'var_vase_custom', { price: 7_000 }); // later catalog changes don't rewrite the order
  const jobs = await board(s);
  assert.equal(jobs.length, 2);
  assert.notEqual(jobs[0].job_id, jobs[1].job_id);
});

test('an order held for the owner\'s OK is blocked by the owner, not the buyer', async () => {
  const s = await stack();
  const askForCaptures: Policy = { ownerId: 'shop_maya', currency: 'USD', rules: [{ id: 'all', type: 'always_approve', kinds: ['payment.capture'] }] };
  await s.policies.put(askForCaptures);
  await placeOrder(s, [{ variant_id: 'var_vase_custom', quantity: 1 }]);
  const [job] = await board(s);
  assert.equal(job.blocked, 'until the owner accepts the order');
  assert.match(job.payment, /approved by the buyer/);
});

test('a commission waits on its deposit, then the owner\'s agent plans it and marks it made', async () => {
  const s = await stack();
  const invoice = await sendCommission(s, 'grace@example.com', { deposit: '20.00' });

  let [job] = await board(s);
  assert.equal(job.blocked, 'until the buyer pays');
  assert.match(job.payment, /waiting for \$40\.00/);

  s.pp.payInvoice(invoice.id, 'deposit');
  [job] = await board(s);
  assert.equal(job.blocked, false);
  assert.match(job.payment, /^deposit paid/);

  const planned = await s.call('plan_job', { job_id: job.job_id, start: '2026-11-20', end: '2026-12-02' }, s.owner);
  assert.deepEqual(planned.data.making, { start: '2026-11-20', end: '2026-12-02', by: 'owner' });

  const made = await s.call('finish_job', { job_id: job.job_id }, s.owner);
  assert.equal(made.isError, false, made.text);
  assert.deepEqual(await board(s), [], 'made work leaves the board');
});

test('a cancelled commission leaves the board', async () => {
  const s = await stack();
  const invoice = await sendCommission(s, 'leo@example.com');
  assert.equal((await board(s)).length, 1);
  invoice.status = 'CANCELLED';
  assert.deepEqual(await board(s), []);
});

test('plans must be real dates, in order, and for this shop\'s own jobs', async () => {
  const s = await stack();
  await sendCommission(s, 'grace@example.com');
  const [job] = await board(s);
  const plan = (start: string, end: string, ctx = s.owner) => s.call('plan_job', { job_id: job.job_id, start, end }, ctx);

  assert.equal((await plan('2026-12-02', '2026-11-20')).isError, true, 'end before start');
  assert.equal((await plan('2026-02-30', '2026-03-05')).isError, true, 'no such date');
  assert.equal((await plan('2026-01-01', '2027-06-01')).isError, true, 'longer than a year');
  assert.match((await s.call('plan_job', { job_id: 'invoice:nope', start: '2026-11-20', end: '2026-11-21' }, s.owner)).text, /not found/);
  assert.equal((await plan('2026-11-20', '2026-11-21', s.buyer)).isError, true, 'buyers cannot plan');
  assert.equal(isDay('2026-02-28'), true);
});
