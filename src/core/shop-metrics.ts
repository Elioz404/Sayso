// The Overview's numbers: the last 7 days against the 7 before, a day-by-day series for each, and what the
// shop's agents did with its money this week. Sales and refunds follow the same definitions as the sales
// summary (charged orders by when they were charged, refunds by when PayPal confirmed them), so the
// dashboard and the assistant never disagree. Minor units throughout; pages format them.

import { addDays, dayIn, startOfDay } from './days.ts';
import type { GuardRecord } from './guard/types.ts';
import type { OrderSummary } from './orders.ts';
import { confirmedRefunds } from './sales-summary.ts';
import { outcomeOf, whoOf } from './trust-report.ts';

export interface Kpi {
  now: number;
  before: number;
  /** One value per day, oldest first, for a sparkline. */
  series: number[];
}

export interface ShopMetrics {
  days: number;
  revenue: Kpi;
  orders: Kpi;
  /** Average order value, in minor units. */
  average: Kpi;
  /** Refunded share of revenue, in basis points (100 = 1%). */
  refundRate: Kpi;
  /** Revenue and refunds per day over twice the window, oldest first, for the chart. */
  daily: { day: string; revenue: number; refunded: number; orders: number }[];
  /** What agents asked for this week, by outcome, in minor units (and how many requests). */
  sayso: { alone: number; approved: number; waiting: number; declined: number; blocked: number; requests: number };
}

/**
 * `orders`: the shop's orders over (at least) the last 2 x `days`; `records`: its Guard records over the
 * same days. Charged orders count on the day they were charged; refunds on the day PayPal confirmed them.
 * Days are the shop's own: `zone` (its time zone) decides when each starts.
 */
export function shopMetrics(orders: readonly OrderSummary[], records: readonly GuardRecord[], options: { now?: Date; days?: number; zone?: string } = {}): ShopMetrics {
  const { now = new Date(), days = 7, zone = 'UTC' } = options;
  const today = dayIn(now.getTime(), zone);
  const start = startOfDay(addDays(today, 1 - days), zone);
  const daily = Array.from({ length: days * 2 }, (_, i) => ({ day: addDays(today, i + 1 - days * 2), revenue: 0, refunded: 0, orders: 0 }));
  const index = new Map(daily.map((d, i) => [d.day, i]));
  for (const o of orders) {
    if (o.status !== 'paid' || !o.paidAt) continue;
    const i = index.get(dayIn(Date.parse(o.paidAt), zone));
    if (i === undefined) continue;
    daily[i].revenue += o.totalMinor ?? 0;
    daily[i].orders += 1;
  }
  for (const r of confirmedRefunds(records)) {
    const i = index.get(dayIn(r.at, zone));
    if (i !== undefined) daily[i].refunded += r.amount;
  }
  const recent = daily.slice(days);
  const earlier = daily.slice(0, days);
  const sum = (rows: typeof daily, key: 'revenue' | 'refunded' | 'orders') => rows.reduce((n, d) => n + d[key], 0);
  const avg = (rows: typeof daily) => (sum(rows, 'orders') ? Math.round(sum(rows, 'revenue') / sum(rows, 'orders')) : 0);
  const rate = (rows: typeof daily) => (sum(rows, 'revenue') ? Math.round((sum(rows, 'refunded') / sum(rows, 'revenue')) * 10_000) : 0);
  // Running averages and rates read better as a line than day-by-day zeros.
  const running = (f: (rows: typeof daily) => number) => recent.map((_, i) => f(daily.slice(i + 1, days + i + 1)));

  // What agents asked of the owner's money this week (a buyer's own checkout is a sale, not a request).
  const week = records.filter((r) => Date.parse(r.createdAt) >= start && whoOf(r.action) !== 'Sayso checkout');
  const by = (outcome: ReturnType<typeof outcomeOf>) =>
    week.filter((r) => outcomeOf(r) === outcome && r.action.kind !== 'policy.update').reduce((n, r) => n + (r.action.amount ?? r.simulation?.amount ?? 0), 0);
  return {
    days,
    revenue: { now: sum(recent, 'revenue'), before: sum(earlier, 'revenue'), series: recent.map((d) => d.revenue) },
    orders: { now: sum(recent, 'orders'), before: sum(earlier, 'orders'), series: recent.map((d) => d.orders) },
    average: { now: avg(recent), before: avg(earlier), series: running(avg) },
    refundRate: { now: rate(recent), before: rate(earlier), series: running(rate) },
    daily,
    sayso: {
      alone: by('Allowed by your rules'),
      approved: by('You said OK'),
      waiting: by('Waiting for you'),
      declined: by('You said no'),
      blocked: by('Blocked by a rule'),
      requests: week.length,
    },
  };
}

/** Change against the previous window, as a whole percentage; undefined when there is nothing to compare. */
export function change({ now, before }: Pick<Kpi, 'now' | 'before'>): number | undefined {
  if (before === 0) return now === 0 ? 0 : undefined;
  return Math.round(((now - before) / before) * 100);
}
