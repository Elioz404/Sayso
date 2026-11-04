'use client';

// Revenue and refunds per day (AG Charts), in the site's own colours and fonts, light or dark.
import { AgCharts, AllCommunityModule, ModuleRegistry, type AgCartesianChartOptions } from 'ag-charts-community';
import { useEffect, useRef } from 'react';

ModuleRegistry.registerModules([AllCommunityModule]);

type Day = { day: string; revenue: number; refunded: number; orders: number };

export function RevenueChart({ daily, currency, minorPerUnit }: { daily: Day[]; currency: string; minorPerUnit: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!box.current) return;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string) => css.getPropertyValue(name).trim();
    const font = getComputedStyle(box.current).fontFamily;
    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
    const data = daily.map((d) => ({
      day: new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: d.revenue / minorPerUnit,
      refunded: d.refunded / minorPerUnit,
      orders: d.orders,
    }));
    const options: AgCartesianChartOptions = {
      container: box.current,
      data,
      background: { visible: false },
      padding: { top: 8, right: 8, bottom: 4, left: 4 },
      legend: { position: 'top', item: { label: { color: token('--ink-2'), fontFamily: font } } },
      series: [
        {
          type: 'bar',
          xKey: 'day',
          yKey: 'revenue',
          yName: 'Revenue',
          fill: token('--say'),
          cornerRadius: 4,
          tooltip: { renderer: ({ datum }) => ({ heading: datum.day, data: [{ label: 'Revenue', value: money.format(datum.revenue) }, { label: 'Orders', value: String(datum.orders) }] }) },
        },
        { type: 'line', xKey: 'day', yKey: 'refunded', yName: 'Refunded', stroke: token('--stop'), marker: { fill: token('--stop'), size: 6 } },
      ],
      axes: {
        x: { type: 'category', position: 'bottom', label: { color: token('--ink-3'), fontFamily: font }, line: { stroke: token('--rule') } },
        y: { type: 'number', position: 'left', label: { color: token('--ink-3'), fontFamily: font, formatter: ({ value }) => money.format(Number(value)) }, gridLine: { style: [{ stroke: token('--rule') }] } },
      },
    };
    const chart = AgCharts.create(options);
    return () => chart.destroy();
  }, [daily, currency, minorPerUnit]);
  return <div ref={box} className="revenue-chart" role="img" aria-label="Revenue and refunds per day" />;
}
