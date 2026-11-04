// The Overview's numbers: the last 7 days against the 7 before, a day-by-day series for each, and what the
// shop's agents did with its money this week. Minor units throughout; pages format them.

import type { OrderSummary } from './orders.ts';
import type { DecisionRow } from './trust-report.ts';

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

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Orders that count as sales: placed and not cancelled by the shop. */
const sold = (o: OrderSummary) => Boolean(o.number) && o.status !== 'released';

export function shopMetrics(orders: OrderSummary[], decisions: DecisionRow[], minorPerUnit: number, now = new Date(), days = 7): ShopMetrics {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY; // end of today, UTC
  const start = end - days * DAY;
  const daily = Array.from({ length: days * 2 }, (_, i) => ({ day: isoDay(end - (days * 2 - i) * DAY), revenue: 0, refunded: 0, orders: 0 }));
  const index = new Map(daily.map((d, i) => [d.day, i]));
  for (const o of orders.filter(sold)) {
    const i = index.get(o.createdAt.slice(0, 10));
    if (i === undefined) continue;
    daily[i].revenue += o.totalMinor ?? 0;
    daily[i].refunded += o.refundedMinor;
    daily[i].orders += 1;
  }
  const recent = daily.slice(days);
  const earlier = daily.slice(0, days);
  const sum = (rows: typeof daily, key: 'revenue' | 'refunded' | 'orders') => rows.reduce((n, d) => n + d[key], 0);
  const avg = (rows: typeof daily) => (sum(rows, 'orders') ? Math.round(sum(rows, 'revenue') / sum(rows, 'orders')) : 0);
  const rate = (rows: typeof daily) => (sum(rows, 'revenue') ? Math.round((sum(rows, 'refunded') / sum(rows, 'revenue')) * 10_000) : 0);
  // Running averages and rates read better as a line than day-by-day zeros.
  const running = (f: (rows: typeof daily) => number) => recent.map((_, i) => f(daily.slice(i + 1, days + i + 1)));

  const week = decisions.filter((d) => Date.parse(d.day) >= start);
  const minor = (major: number) => Math.round(major * minorPerUnit);
  return {
    days,
    revenue: { now: sum(recent, 'revenue'), before: sum(earlier, 'revenue'), series: recent.map((d) => d.revenue) },
    orders: { now: sum(recent, 'orders'), before: sum(earlier, 'orders'), series: recent.map((d) => d.orders) },
    average: { now: avg(recent), before: avg(earlier), series: running(avg) },
    refundRate: { now: rate(recent), before: rate(earlier), series: running(rate) },
    daily,
    sayso: {
      alone: minor(week.reduce((n, d) => n + d.movedAlone, 0)),
      approved: minor(week.reduce((n, d) => n + d.approved, 0)),
      waiting: minor(week.reduce((n, d) => n + d.waiting, 0)),
      declined: minor(week.reduce((n, d) => n + d.declined, 0)),
      blocked: minor(week.reduce((n, d) => n + d.blocked, 0)),
      requests: week.length,
    },
  };
}

/** Change against the previous window, as a whole percentage; undefined when there is nothing to compare. */
export function change({ now, before }: Pick<Kpi, 'now' | 'before'>): number | undefined {
  if (before === 0) return now === 0 ? 0 : undefined;
  return Math.round(((now - before) / before) * 100);
}
