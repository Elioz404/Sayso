'use client';

// The Trust report, drawn by AG Studio: three pages built from the rows src/core/trust-report.ts makes.
// Loaded in the browser only (AG Studio needs the DOM). The owner reads it in view mode and can switch to
// edit mode to rearrange it; their layout is kept in this browser.

import { AgStudio, AgStudioProvider } from 'ag-studio-react';
import { studioTheme, type AgDataSourcesDefinition, type AgReportState } from 'ag-studio';
import { useEffect, useMemo, useState } from 'react';
import type { TrustReport } from '@/core/trust-report.ts';

const LAYOUT_KEY = 'sayso-trust-layout-v1';

// Sayso's colours, light and dark (the wrapper picks the mode from the browser's setting).
const theme = studioTheme
  .withParams({
    accentColor: '#b04a22',
    backgroundColor: '#fffdfa',
    foregroundColor: '#221c17',
    textColor: '#221c17',
    borderColor: '#e6ddd2',
    fontFamily: 'var(--font-body)',
    chartFontFamily: 'var(--font-body)',
    studioCanvasBackgroundColor: '#f6f2ec',
    studioWidgetTitleFontSize: 15,
    studioValueWidgetFontSize: 30,
    // In the order the outcome series are listed: on their own, said OK, waiting, said no, blocked.
    chartPaletteFills1Color: '#5b8f6a',
    chartPaletteFills2Color: '#b04a22',
    chartPaletteFills3Color: '#d9a43a',
    chartPaletteFills4Color: '#7d6a5e',
    chartPaletteFills5Color: '#b3203f',
    chartPaletteFills6Color: '#4a4dc9',
    chartPaletteFills7Color: '#6aa3b8',
    chartPaletteFills8Color: '#c9b9a8',
    chartPaletteStrokes1Color: '#5b8f6a',
    chartPaletteStrokes2Color: '#b04a22',
    chartPaletteStrokes3Color: '#d9a43a',
    chartPaletteStrokes4Color: '#7d6a5e',
    chartPaletteStrokes5Color: '#b3203f',
    chartPaletteStrokes6Color: '#4a4dc9',
    chartPaletteStrokes7Color: '#6aa3b8',
    chartPaletteStrokes8Color: '#c9b9a8',
    browserColorScheme: 'light',
  } as Record<string, unknown>)
  .withParams(
    {
      accentColor: '#e08a62',
      backgroundColor: '#211c18',
      foregroundColor: '#efe7de',
      textColor: '#efe7de',
      borderColor: '#3a322b',
      studioCanvasBackgroundColor: '#1b1714',
      browserColorScheme: 'dark',
    } as Record<string, unknown>,
    'dark',
  );

// Amounts in the shop's currency, written the way the rest of Sayso writes them.
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (id: string, name: string) => ({ id, name, format: 'currencyFormat', formatOptions: { format: usd } }) as const;
const text = (id: string, name: string) => ({ id, name, format: 'textFormat' }) as const;
const count = (id: string, name: string) => ({ id, name, format: 'integerFormat' }) as const;

function sources(report: TrustReport): AgDataSourcesDefinition {
  return {
    sources: [
      {
        id: 'decisions',
        name: 'Say-so decisions',
        description: 'One row per money move or rule change an agent or person asked for, and what Guard and the owner did about it.',
        data: report.decisions,
        fields: [
          text('day', 'Day'),
          text('action', 'Action'),
          text('who', 'Who asked'),
          text('outcome', 'Outcome'),
          money('amount', 'Amount'),
          money('movedAlone', 'Moved on their own'),
          money('approved', 'Waited, you said OK'),
          money('waiting', 'Waiting for you'),
          money('declined', 'You said no'),
          money('blocked', 'Blocked by a rule'),
          count('requests', 'Requests'),
          count('nAlone', 'On their own'),
          count('nApproved', 'You said OK'),
          count('nWaiting', 'Waiting for you'),
          count('nDeclined', 'You said no'),
          count('nBlocked', 'Blocked'),
          count('minutesToDecide', 'Minutes to decide'),
          text('why', 'Why'),
          text('readBack', 'PayPal'),
          text('chain', 'Audit chain'),
          { id: 'id', name: 'Record', format: 'textFormat', hide: true },
        ],
      },
      {
        id: 'sales',
        name: 'Sales',
        description: 'One row per order, with the channel it came from.',
        data: report.sales,
        fields: [text('order', 'Order'), text('day', 'Day'), text('channel', 'Channel'), text('status', 'Status'), money('total', 'Revenue'), money('refunded', 'Refunded'), money('net', 'Net'), count('orders', 'Orders')],
      },
      {
        id: 'trail',
        description: "Each order's money moves, checked against PayPal and the audit chain.",
        data: report.trail,
        fields: [
          text('order', 'Order'),
          text('day', 'Day'),
          text('buyer', 'Buyer'),
          text('channel', 'Channel'),
          money('total', 'Total'),
          money('refunded', 'Refunded'),
          count('moneyMoves', 'Money moves'),
          text('readBack', 'PayPal read-back'),
          text('chain', 'Audit chain'),
        ],
      },
    ],
  } as AgDataSourcesDefinition;
}

const title = (text: string) => ({ title: { enabled: true, text } });
const kpi = (field: string, label: string) => ({ type: 'value', dataMapping: { value: [{ id: field, aggregation: 'sum' }] }, format: title(label) });
const at = (x: number, y: number, w: number, h: number) => ({ xTrack: x, yTrack: y, xSpan: w, ySpan: h });

const PAGES = [
  { id: 'sayso', label: 'Agents & say-so' },
  { id: 'sales', label: 'Where sales come from' },
  { id: 'trail', label: 'Money trail' },
] as const;
type PageId = (typeof PAGES)[number]['id'];

function report(r: TrustReport): AgReportState {
  const limit = r.facts.refundLimit ? `Your agents refund up to ${r.facts.refundLimit} on their own; bigger refunds wait for you. ` : '';
  return {
    pages: [
      {
        id: 'sayso',
        widgets: {
          alone: kpi('decisions.movedAlone', 'Agents, on their own'),
          approved: kpi('decisions.approved', 'Waited, you said OK'),
          declined: kpi('decisions.declined', 'You said no'),
          blocked: kpi('decisions.blocked', 'Blocked by your rules'),
          byDay: {
            type: 'column-chart-stacked',
            dataMapping: {
              categoryKey: [{ id: 'decisions.day' }],
              valueKey: [
                { id: 'decisions.movedAlone', aggregation: 'sum' },
                { id: 'decisions.approved', aggregation: 'sum' },
                { id: 'decisions.waiting', aggregation: 'sum' },
                { id: 'decisions.declined', aggregation: 'sum' },
                { id: 'decisions.blocked', aggregation: 'sum' },
              ],
              tooltipKey: [],
            },
            format: title('Money agents asked to move, by day'),
          },
          outcomes: {
            type: 'column-chart-stacked',
            dataMapping: {
              categoryKey: [{ id: 'decisions.action' }],
              valueKey: ['nAlone', 'nApproved', 'nWaiting', 'nDeclined', 'nBlocked'].map((f) => ({ id: `decisions.${f}`, aggregation: 'sum' })),
              tooltipKey: [],
            },
            format: title('How many requests, by outcome'),
          },
          who: {
            type: 'bar-chart-stacked',
            dataMapping: {
              categoryKey: [{ id: 'decisions.who' }],
              valueKey: [
                { id: 'decisions.movedAlone', aggregation: 'sum' },
                { id: 'decisions.approved', aggregation: 'sum' },
                { id: 'decisions.declined', aggregation: 'sum' },
                { id: 'decisions.blocked', aggregation: 'sum' },
              ],
              tooltipKey: [],
            },
            format: title('Who asked, and what Guard did'),
          },
          note: {
            type: 'text',
            dataMapping: {},
            format: {
              ...title('How to read this'),
              style: {
                typography: { fontSize: 14 },
                textAlign: 'left',
                verticalAlign: 'top',
                text: `Every refund, capture, invoice and rule change goes through Guard: simulated against PayPal, checked against your rules, then done, held for you, or blocked. ${limit}Agents can ask to change the rules, but only you can. ${r.facts.records} records, ${r.facts.readBack} read back from PayPal, audit chain ${r.facts.chainIntact ? 'intact' : 'edited'}.`,
              },
            },
          },
          table: {
            type: 'grid',
            dataMapping: {
              cols: [
                { id: 'decisions.day' },
                { id: 'decisions.who' },
                { id: 'decisions.action' },
                { id: 'decisions.outcome' },
                { id: 'decisions.amount', aggregation: 'sum' },
                { id: 'decisions.minutesToDecide', aggregation: 'avg' },
                { id: 'decisions.readBack' },
                { id: 'decisions.why' },
              ],
            },
            format: title('Every request'),
          },
        },
        widgetLayout: {
          alone: at(0, 0, 6, 6),
          approved: at(6, 0, 6, 6),
          declined: at(12, 0, 6, 6),
          blocked: at(18, 0, 6, 6),
          byDay: at(0, 6, 15, 13),
          outcomes: at(15, 6, 9, 13),
          who: at(0, 19, 13, 11),
          note: at(13, 19, 11, 11),
          table: at(0, 30, 24, 16),
        },
      },
      {
        id: 'sales',
        widgets: {
          revenue: kpi('sales.total', 'Revenue'),
          orders: kpi('sales.orders', 'Orders'),
          refunded: kpi('sales.refunded', 'Refunded'),
          net: kpi('sales.net', 'Net'),
          channels: {
            type: 'donut-chart',
            dataMapping: { categoryKey: [{ id: 'sales.channel' }], valueKey: [{ id: 'sales.total', aggregation: 'sum' }], tooltipKey: [] },
            format: title('Revenue by channel'),
          },
          byDay: {
            type: 'line-chart',
            dataMapping: { categoryKey: [{ id: 'sales.day' }], valueKey: [{ id: 'sales.total', aggregation: 'sum' }, { id: 'sales.net', aggregation: 'sum' }], tooltipKey: [] },
            format: title('Revenue and net, by day'),
          },
          table: {
            type: 'grid',
            dataMapping: {
              cols: [{ id: 'sales.channel' }, { id: 'sales.orders', aggregation: 'sum' }, { id: 'sales.total', aggregation: 'sum' }, { id: 'sales.refunded', aggregation: 'sum' }, { id: 'sales.net', aggregation: 'sum' }],
            },
            format: title('By channel'),
          },
        },
        widgetLayout: {
          revenue: at(0, 0, 6, 6),
          orders: at(6, 0, 6, 6),
          refunded: at(12, 0, 6, 6),
          net: at(18, 0, 6, 6),
          channels: at(0, 6, 10, 13),
          byDay: at(10, 6, 14, 13),
          table: at(0, 19, 24, 14),
        },
      },
      {
        id: 'trail',
        widgets: {
          note: {
            type: 'text',
            dataMapping: {},
            format: {
              ...title('Checked per transaction, not by a nightly report'),
              style: {
                typography: { fontSize: 14 },
                textAlign: 'left',
                verticalAlign: 'top',
                text: 'Guard reads every capture and refund back from PayPal before it counts, and seals each step into a hash chain. If PayPal disagrees or a record is edited later, it shows here.',
              },
            },
          },
          moves: kpi('trail.moneyMoves', 'Money moves'),
          table: {
            type: 'grid',
            dataMapping: {
              cols: [
                { id: 'trail.order' },
                { id: 'trail.day' },
                { id: 'trail.buyer' },
                { id: 'trail.channel' },
                { id: 'trail.total', aggregation: 'sum' },
                { id: 'trail.refunded', aggregation: 'sum' },
                { id: 'trail.moneyMoves', aggregation: 'sum' },
                { id: 'trail.readBack' },
                { id: 'trail.chain' },
              ],
            },
            format: title('Every order'),
          },
        },
        widgetLayout: {
          note: at(0, 0, 18, 6),
          moves: at(18, 0, 6, 6),
          table: at(0, 6, 24, 20),
        },
      },
    ],
    selectedPageId: 'sayso',
    panels: { filters: { collapsed: true } },
  } as unknown as AgReportState;
}

export default function TrustStudio({ data, licenseKey }: { data: TrustReport; licenseKey?: string }) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [page, setPage] = useState<PageId>('sayso');
  const [key, setKey] = useState(0);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setDark(document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  const dataSources = useMemo(() => sources(data), [data]);
  // The owner's own arrangement, if they rearranged it in this browser, opened on the chosen page.
  const initialState = useMemo(() => {
    let state = report(data);
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) state = JSON.parse(saved) as AgReportState;
    } catch {
      // nothing saved, or storage is off
    }
    return { ...state, selectedPageId: page } as AgReportState;
    // `key` remounts Studio when the page or a reset changes the starting state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page, key]);

  const studio = (
    <AgStudio
      key={`${page}-${key}`}
      style={{ height: '100%', width: '100%' }}
      data={dataSources}
      mode={mode}
      theme={theme}
      initialState={initialState}
      onStateUpdated={(e: { state?: AgReportState }) => {
        if (mode !== 'edit' || !e.state) return;
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(e.state));
        } catch {
          // storage off: the change lasts until the page reloads
        }
      }}
    />
  );
  return (
    <div className="trust">
      <div className="trust-tools">
        <div className="dock-tabs trust-pages" role="tablist" aria-label="Report pages">
          {PAGES.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={page === p.id} className="dock-tab" onClick={() => setPage(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-small" onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}>
          {mode === 'view' ? 'Rearrange' : 'Done'}
        </button>
        {mode === 'edit' && (
          <button
            type="button"
            className="btn btn-quiet btn-small"
            onClick={() => {
              try {
                localStorage.removeItem(LAYOUT_KEY);
              } catch {
                // nothing to clear
              }
              setKey((k) => k + 1);
            }}
          >
            Reset layout
          </button>
        )}
      </div>
      <div className="trust-canvas ag-theme-mode" data-ag-theme-mode={dark ? 'dark' : 'light'}>
        {licenseKey ? <AgStudioProvider licenseKey={licenseKey}>{studio}</AgStudioProvider> : studio}
      </div>
    </div>
  );
}
