// A shop's sales for a period, computed here so nobody (least of all a model) adds up lists by hand: sales,
// refunds, net, orders, average order, top products and channels, against the period just before, with a
// straight-line estimate while the period is still running. Minor units throughout, formatted at the end.
// Sales count when they were charged; refunds when PayPal confirmed them. Days are the shop's own (its time
// zone; UTC when it has none).

import { addDays, dayIn, daysBetween, isDay, monthStart, startOfDay, weekdayOf, type Day } from './days.ts';
import { formatMoney, toMinor } from './money.ts';
import type { GuardRecord } from './guard/types.ts';
import type { StoredCart } from './stores.ts';
import { channelName } from './trust-report.ts';

export const PERIODS = ['today', 'this_week', 'last_7_days', 'this_month', 'last_month', 'last_30_days', 'this_year'] as const;
export type Period = (typeof PERIODS)[number];

export interface SalesQuery {
  period?: Period;
  /** A custom range, both days included (YYYY-MM-DD); overrides `period`. */
  from?: string;
  to?: string;
}

interface Range {
  label: string;
  /** Inclusive start, exclusive end, ms. */
  start: number;
  end: number;
}

/** The longest custom range: two years. */
const MAX_DAYS = 731;

/**
 * The period asked for and the one just before it, of the same length (a calendar month for months), in
 * the shop's days: `zone` decides when each day starts.
 */
export function resolvePeriod(query: SalesQuery, now: Date, zone = 'UTC'): { current: Range; previous: Range } {
  const at = (day: Day) => startOfDay(day, zone);
  const range = (label: string, first: Day, end: Day): Range => ({ label, start: at(first), end: at(end) });
  if (query.from || query.to) {
    const from = query.from ?? query.to!;
    const to = query.to ?? query.from!;
    for (const day of [from, to]) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('from and to are days like 2026-11-01');
      if (!isDay(day)) throw new RangeError(`There is no ${day}`);
    }
    const length = daysBetween(from, to) + 1;
    if (length < 1) throw new RangeError('to comes before from');
    if (length > MAX_DAYS) throw new RangeError(`Up to ${MAX_DAYS} days at a time`);
    return { current: range(`${from} to ${to}`, from, addDays(to, 1)), previous: range('the same number of days before', addDays(from, -length), from) };
  }
  const today = dayIn(now.getTime(), zone);
  const tomorrow = addDays(today, 1);
  const pair = (current: Range, previous: Range) => ({ current, previous });
  switch (query.period ?? 'this_month') {
    case 'today':
      return pair(range('today', today, tomorrow), range('yesterday', addDays(today, -1), today));
    case 'this_week': {
      const monday = addDays(today, -weekdayOf(today));
      return pair(range('this week (since Monday)', monday, addDays(monday, 7)), range('last week', addDays(monday, -7), monday));
    }
    case 'last_7_days':
      return pair(range('the last 7 days', addDays(today, -6), tomorrow), range('the 7 days before', addDays(today, -13), addDays(today, -6)));
    case 'last_30_days':
      return pair(range('the last 30 days', addDays(today, -29), tomorrow), range('the 30 days before', addDays(today, -59), addDays(today, -29)));
    case 'last_month':
      return pair(range('last month', monthStart(today, -1), monthStart(today)), range('the month before', monthStart(today, -2), monthStart(today, -1)));
    case 'this_year': {
      const jan = `${today.slice(0, 4)}-01-01`;
      return pair(range('this year', jan, monthStart(jan, 12)), range('last year', monthStart(jan, -12), jan));
    }
    case 'this_month':
    default:
      return pair(range('this month', monthStart(today), monthStart(today, 1)), range('last month', monthStart(today, -1), monthStart(today)));
  }
}

/** Refunds PayPal confirmed, dated when it did: the one definition sales figures use everywhere. */
export function confirmedRefunds(records: readonly GuardRecord[]): { at: number; amount: number; cartId?: string }[] {
  return records
    .filter((r) => r.action.kind === 'refund.create' && r.status === 'verified')
    .map((r) => ({
      at: Date.parse(r.events.find((e) => e.type === 'verified')?.at ?? r.createdAt),
      amount: r.action.amount ?? 0,
      ...(typeof r.action.params?.cartId === 'string' ? { cartId: r.action.params.cartId } : {}),
    }));
}

interface Totals {
  sales: number;
  orders: number;
  refunds: number;
  refundCount: number;
}

function totalsIn(range: Range, charged: StoredCart[], refunds: { at: number; amount: number }[]): Totals {
  const inRange = (t: number) => t >= range.start && t < range.end;
  const sold = charged.filter((c) => inRange(Date.parse(c.paidAt ?? c.createdAt)));
  const back = refunds.filter((r) => inRange(r.at));
  return {
    sales: sold.reduce((n, c) => n + (c.cart.totals ? toMinor(c.cart.totals.total) : 0), 0),
    orders: sold.length,
    refunds: back.reduce((n, r) => n + r.amount, 0),
    refundCount: back.length,
  };
}

/** "+12%", "-3%", "new" or "same": how the period compares with the one before. */
export function change(now: number, before: number): string {
  if (now === before) return 'same';
  if (before === 0) return 'new';
  // A percentage of a negative number reads backwards (net -$20 to +$100 is not "-600%").
  if (before < 0) return now > before ? 'up from below zero' : 'down, still below zero';
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/**
 * `placed`: the shop's placed orders (charged or held); `refunds`: its verified refund records. `partial`:
 * the store returned as many orders as it was asked for, so older ones may be missing.
 */
export function salesSummary(input: { placed: StoredCart[]; refunds: GuardRecord[]; currency: string; query: SalesQuery; now: Date; zone?: string; partial?: boolean }) {
  const { currency, now } = input;
  const zone = input.zone ?? 'UTC';
  const money = (minor: number) => formatMoney(minor, currency);
  const { current, previous } = resolvePeriod(input.query, now, zone);
  const charged = input.placed.filter((c) => c.captureId && !c.released);
  const held = input.placed.filter((c) => !c.captureId && !c.released);
  const refunds = confirmedRefunds(input.refunds);

  // While the period runs, compare like with like: the period before, up to the same point in it.
  const running = now.getTime() >= current.start && now.getTime() < current.end;
  const sofar = running ? { label: `${previous.label}, up to the same point`, start: previous.start, end: Math.min(previous.end, previous.start + (now.getTime() - current.start)) } : previous;
  const t = totalsIn(current, charged, refunds);
  const p = totalsIn(sofar, charged, refunds);
  const whole = running ? totalsIn(previous, charged, refunds) : undefined;
  const inPeriod = charged.filter((c) => {
    const at = Date.parse(c.paidAt ?? c.createdAt);
    return at >= current.start && at < current.end;
  });

  const products = new Map<string, { units: number; sales: number }>();
  for (const c of inPeriod) {
    for (const item of c.cart.items) {
      const name = item.name ?? item.variant_id ?? 'Item';
      const row = products.get(name) ?? { units: 0, sales: 0 };
      row.units += item.quantity;
      row.sales += item.price ? toMinor(item.price) * item.quantity : 0;
      products.set(name, row);
    }
  }
  const channels = new Map<string, { orders: number; sales: number }>();
  for (const c of inPeriod) {
    const name = channelName(c.channel);
    const row = channels.get(name) ?? { orders: 0, sales: 0 };
    row.orders += 1;
    row.sales += c.cart.totals ? toMinor(c.cart.totals.total) : 0;
    channels.set(name, row);
  }

  // While the period runs, a straight line from the days so far to the whole period.
  const first = dayIn(current.start, zone);
  const elapsed = Math.max(1, daysBetween(first, dayIn(now.getTime(), zone)) + 1);
  const length = daysBetween(first, dayIn(current.end, zone));
  const estimate =
    running && length > 1 && t.orders > 0
      ? {
          note:
            elapsed < 7 || t.orders < 5
              ? `A rough guess: a straight line from only ${elapsed} of ${length} days and ${t.orders} order${t.orders === 1 ? '' : 's'} so far. Say how rough it is.`
              : `Straight line from ${elapsed} of ${length} days so far; an estimate, not a promise.`,
          sales: money(Math.round((t.sales / elapsed) * length)),
          orders: Math.round((t.orders / elapsed) * length),
          net: money(Math.round(((t.sales - t.refunds) / elapsed) * length)),
        }
      : undefined;

  return {
    period: current.label,
    from: first,
    to: dayIn(current.end - 1, zone),
    time_zone: zone,
    currency,
    sales: money(t.sales),
    orders: t.orders,
    average_order: t.orders ? money(Math.round(t.sales / t.orders)) : undefined,
    refunds: money(t.refunds),
    refund_count: t.refundCount,
    refund_rate: t.sales ? `${Math.round((t.refunds / t.sales) * 1000) / 10}%` : undefined,
    net: money(t.sales - t.refunds),
    compared_with: {
      period: sofar.label,
      sales: money(p.sales),
      orders: p.orders,
      refunds: money(p.refunds),
      net: money(p.sales - p.refunds),
      change: { sales: change(t.sales, p.sales), orders: change(t.orders, p.orders), net: change(t.sales - t.refunds, p.sales - p.refunds) },
    },
    ...(whole ? { all_of_the_period_before: { period: previous.label, sales: money(whole.sales), orders: whole.orders, net: money(whole.sales - whole.refunds) } } : {}),
    ...(estimate ? { estimate } : {}),
    top_products: [...products.entries()]
      .sort((a, b) => b[1].sales - a[1].sales || b[1].units - a[1].units)
      .slice(0, 5)
      .map(([name, r]) => ({ name, units: r.units, sales: money(r.sales) })),
    channels: [...channels.entries()].sort((a, b) => b[1].sales - a[1].sales).map(([name, r]) => ({ channel: name, orders: r.orders, sales: money(r.sales) })),
    waiting_for_owner_now: held.length ? { orders: held.length, amount: money(held.reduce((n, c) => n + (c.cart.totals ? toMinor(c.cart.totals.total) : 0), 0)) } : undefined,
    notes: [
      `Sales count when they were charged; refunds when PayPal confirmed them. Days are in ${zone}.`,
      'Net is sales minus refunds. PayPal fees and paid invoices are not included.',
      ...(input.partial ? ['Only the most recent orders were read; older ones in this period may be missing.'] : []),
    ],
  };
}

export type SalesSummary = ReturnType<typeof salesSummary>;
