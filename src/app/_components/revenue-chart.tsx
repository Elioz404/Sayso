// Revenue (bars) and refunds (a line, when there are any) per day, drawn on the server as plain SVG in the site's own colours:
// two weeks of numbers need no chart library in the browser. Each day says its figures on hover.

type Day = { day: string; revenue: number; refunded: number; orders: number };

// About the size it is drawn at, so its labels read at their real size.
const W = 440;
const H = 200;
const PAD = { top: 10, right: 6, bottom: 24, left: 48 };

export function RevenueChart({ daily, currency, minorPerUnit }: { daily: Day[]; currency: string; minorPerUnit: number }) {
  const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
  const exact = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  const label = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const top = niceCeiling(Math.max(...daily.map((d) => Math.max(d.revenue, d.refunded)), 0) / minorPerUnit);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(daily.length, 1);
  const y = (minor: number) => PAD.top + plotH - (top ? (minor / minorPerUnit / top) * plotH : 0);
  const x = (i: number) => PAD.left + slot * i + slot / 2;
  const ticks = top ? [0, top / 2, top] : [0];
  const tick = top >= 10 ? whole : exact; // small scales keep their cents
  const every = Math.ceil(daily.length / 7); // a date under every other bar at most
  const refunds = daily.map((d, i) => `${x(i).toFixed(1)},${y(d.refunded).toFixed(1)}`).join(' ');
  const total = daily.reduce((n, d) => n + d.revenue, 0);
  const anyRefund = daily.some((d) => d.refunded);
  if (!total && !anyRefund) {
    return <p className="revenue-chart revenue-chart-empty small muted">No sales in the last {daily.length} days yet.</p>;
  }

  return (
    <figure className="revenue-chart">
      <div className="chart-legend small">
        <span className="chart-key chart-key-revenue">Revenue</span>
        {anyRefund && <span className="chart-key chart-key-refunds">Refunded</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Revenue per day over ${daily.length} days, ${exact.format(total / minorPerUnit)} in all`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t * minorPerUnit)} y2={y(t * minorPerUnit)} />
            <text className="chart-axis" x={PAD.left - 8} y={y(t * minorPerUnit)} textAnchor="end" dominantBaseline="middle">
              {tick.format(t)}
            </text>
          </g>
        ))}
        {daily.map((d, i) => {
          const barW = Math.max(2, slot * 0.6);
          const height = Math.max(0, PAD.top + plotH - y(d.revenue));
          return (
            <g key={d.day}>
              <title>{`${label(d.day)}: ${exact.format(d.revenue / minorPerUnit)} from ${d.orders} order${d.orders === 1 ? '' : 's'}${d.refunded ? `, ${exact.format(d.refunded / minorPerUnit)} refunded` : ''}`}</title>
              {/* The whole day's column answers the hover, not only its bar. */}
              <rect x={x(i) - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {height > 0 && <rect className="chart-bar" x={x(i) - barW / 2} y={y(d.revenue)} width={barW} height={height} rx={Math.min(4, barW / 2)} />}
              {i % every === (daily.length - 1) % every && (
                <text className="chart-axis" x={x(i)} y={H - 8} textAnchor="middle">
                  {label(d.day)}
                </text>
              )}
            </g>
          );
        })}
        {anyRefund && <polyline className="chart-line" points={refunds} />}
        {daily.map((d, i) => (d.refunded ? <circle key={d.day} className="chart-dot" cx={x(i)} cy={y(d.refunded)} r={3} /> : null))}
      </svg>
    </figure>
  );
}

/** A round top for the scale: 1, 2 or 5 times a power of ten, at or above `value`. */
function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}
