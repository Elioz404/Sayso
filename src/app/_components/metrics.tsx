// The Overview's building blocks, drawn on the server (plain SVG, no script): a KPI card with its week as a
// sparkline and the change against the week before, and the say-so bar, which shows in one line what the
// shop's agents did with its money this week.

import { change, type Kpi } from '@/core/shop-metrics.ts';

/** A week as a small line with a soft area under it; flat weeks draw a flat line. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const w = 120;
  const h = 36;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((v, i) => [values.length < 2 ? w / 2 : (i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon points={area} className="spark-area" />
      <polyline points={line} className="spark-line" />
    </svg>
  );
}

/**
 * One headline number for the week. `upIsGood` colours the change: more revenue is good news, a higher
 * refund rate is not.
 */
export function KpiCard({ label, value, kpi, upIsGood = true, days }: { label: string; value: string; kpi: Kpi; upIsGood?: boolean; days: number }) {
  const pct = change(kpi);
  const tone = pct === undefined || pct === 0 ? 'flat' : pct > 0 === upIsGood ? 'up' : 'down';
  return (
    <article className="kpi">
      <span className="kpi-label">{label}</span>
      <b className="kpi-value">{value}</b>
      <span className={`kpi-change kpi-${tone}`}>
        {pct === undefined ? 'new this week' : pct === 0 ? 'same as' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs`}
        {pct === undefined ? '' : ` the ${days} days before`}
      </span>
      <Sparkline values={kpi.series} label={`${label}, day by day`} />
    </article>
  );
}

const SEGMENTS = [
  { key: 'alone', label: 'Agents, on their own', className: 'seg-alone' },
  { key: 'approved', label: 'Waited, you said OK', className: 'seg-approved' },
  { key: 'waiting', label: 'Waiting for you', className: 'seg-waiting' },
  { key: 'declined', label: 'You said no', className: 'seg-declined' },
  { key: 'blocked', label: 'Blocked by your rules', className: 'seg-blocked' },
] as const;

/** What agents asked to do with the shop's money this week, split by what happened, in one bar. */
export function SaysoBar({ sayso, format }: { sayso: Record<(typeof SEGMENTS)[number]['key'], number> & { requests: number }; format: (minor: number) => string }) {
  const total = SEGMENTS.reduce((n, s) => n + sayso[s.key], 0);
  return (
    <div className="sayso-bar">
      <div className="sayso-track" role="img" aria-label={SEGMENTS.map((s) => `${s.label}: ${format(sayso[s.key])}`).join(', ')}>
        {total === 0 ? <span className="seg seg-empty" style={{ flex: 1 }} /> : SEGMENTS.filter((s) => sayso[s.key] > 0).map((s) => <span key={s.key} className={`seg ${s.className}`} style={{ flex: sayso[s.key] }} />)}
      </div>
      <ul className="sayso-legend">
        {SEGMENTS.map((s) => (
          <li key={s.key} className={sayso[s.key] ? undefined : 'is-zero'}>
            <i className={`seg ${s.className}`} aria-hidden="true" />
            <span className="small soft">{s.label}</span>
            <b>{format(sayso[s.key])}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
