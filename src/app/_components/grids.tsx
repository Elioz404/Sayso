'use client';

// AG Grid (Community) views for the owner area. Columns fit the container (no sideways scrolling):
// secondary columns hide on narrow screens. Orders and activity rows open their detail page; the
// catalog is edited in place.

import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  ModuleRegistry,
  PaginationModule,
  QuickFilterModule,
  TooltipModule,
  themeQuartz,
  NumberEditorModule,
  RenderApiModule,
  RowApiModule,
  UndoRedoEditModule,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VariantRow } from '@/core/catalog-view.ts';
import { decimalsFor, formatMoney } from '@/core/money.ts';
import { callApi } from './api.ts';
import { formatWhen } from './time.tsx';
import { Status } from './ui.tsx';

// Only the features these grids use, so the bundle carries nothing else.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CellStyleModule,
  ColumnAutoSizeModule,
  CsvExportModule,
  PaginationModule,
  QuickFilterModule,
  TooltipModule,
  NumberEditorModule,
  UndoRedoEditModule,
  RowApiModule,
  RenderApiModule,
]);

// Follows the site's light/dark tokens instead of a fixed palette.
const theme = themeQuartz.withParams({
  backgroundColor: 'var(--sheet)',
  foregroundColor: 'var(--ink)',
  textColor: 'var(--ink)',
  subtleTextColor: 'var(--ink-3)',
  borderColor: 'var(--rule)',
  headerBackgroundColor: 'var(--paper-2)',
  headerTextColor: 'var(--ink-3)',
  headerFontWeight: 600,
  headerFontSize: 13,
  accentColor: 'var(--say)',
  oddRowBackgroundColor: 'var(--sheet)',
  rowHoverColor: 'var(--paper)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  wrapperBorderRadius: 12,
  rowHeight: 58,
  headerHeight: 42,
  cellHorizontalPadding: 16,
  columnBorder: false,
});

/**
 * AG Grid measures the page, so it renders only in the browser (a skeleton holds its place). The
 * container's width decides which columns show: secondary ones hide below 720px.
 */
function useGridSize(): { ref: (el: HTMLDivElement | null) => void; width: number } {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    setWidth(el.clientWidth);
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.current.observe(el);
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  return { ref, width };
}

const NARROW = 720;
const FIT = { type: 'fitGridWidth' } as const;

function GridSkeleton({ rows }: { rows: number }) {
  return <div className="grid-skeleton" style={{ height: 42 + Math.max(1, Math.min(rows, 15)) * 58 }} aria-hidden="true" />;
}

const RIGHT = ['ag-right-aligned-cell', 'num'];


export interface OrderRow {
  id: string;
  number: string;
  /** ISO time: sorts correctly, shown in the viewer's time zone. */
  placed: string;
  status: string;
  total: string;
  totalMinor: number;
  refunded: string;
  items: string;
  via: string;
}

function OrderCell({ data }: ICellRendererParams<OrderRow>) {
  return (
    <span className="cell-two">
      <b>{data?.number}</b>
      <small>{data && formatWhen(data.placed)}</small>
    </span>
  );
}

function ItemsCell({ data }: ICellRendererParams<OrderRow>) {
  return (
    <span className="cell-two">
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{data?.items}</span>
      <small>via {data?.via}</small>
    </span>
  );
}

function StatusCell({ value }: ICellRendererParams) {
  return <Status value={String(value ?? '')} />;
}

export function OrdersGrid({ rows }: { rows: OrderRow[] }) {
  const router = useRouter();
  const grid = useRef<AgGridReact<OrderRow>>(null);
  const [filter, setFilter] = useState('');
  const { ref, width } = useGridSize();
  const narrow = width < NARROW;
  const columns = useMemo<ColDef<OrderRow>[]>(
    () => [
      { field: 'number', headerName: 'Order', cellRenderer: OrderCell, minWidth: 120, flex: 1.2, getQuickFilterText: (p) => `${p.data?.number} ${p.data ? formatWhen(p.data.placed) : ''}` },
      { field: 'status', cellRenderer: StatusCell, minWidth: 104, flex: 1 },
      { field: 'items', headerName: 'Items', cellRenderer: ItemsCell, minWidth: 180, flex: 2.2, hide: narrow, getQuickFilterText: (p) => `${p.data?.items} ${p.data?.via}` },
      { field: 'refunded', headerName: 'Refunded', minWidth: 96, flex: 0.8, hide: narrow, type: 'rightAligned', cellClass: RIGHT },
      {
        field: 'total',
        headerName: 'Total',
        minWidth: 84,
        flex: 0.8,
        type: 'rightAligned',
        cellClass: RIGHT,
        cellStyle: { fontWeight: 650 },
        comparator: (_a, _b, x, y) => (x.data?.totalMinor ?? 0) - (y.data?.totalMinor ?? 0),
      },
    ],
    [narrow],
  );

  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      <div className="row">
        <label htmlFor="order-search" className="sr-only">
          Search orders
        </label>
        <input id="order-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search orders, items or agents" style={{ flex: 1, minWidth: 0 }} />
        <button className="btn" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: 'sayso-orders.csv', columnKeys: ['number', 'status', 'items', 'refunded', 'total'] })}>
          Export CSV
        </button>
      </div>
      <div className="grid-clickable" ref={ref}>
        {width ? (
          <AgGridReact<OrderRow>
            ref={grid}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
            autoSizeStrategy={FIT}
            onGridSizeChanged={(e) => e.api.sizeColumnsToFit()}
            quickFilterText={filter}
            domLayout="autoHeight"
            containerStyle={{ height: 'auto' }}
            onRowClicked={(e) => e.data && router.push(`/owner/orders/${e.data.id}`)}
            pagination={rows.length > 20}
            paginationPageSize={20}
            overlayNoRowsTemplate="No orders match."
          />
        ) : (
          <GridSkeleton rows={rows.length} />
        )}
      </div>
    </div>
  );
}

export interface AuditRow {
  id: string;
  /** ISO time. */
  at: string;
  action: string;
  amount: string;
  by: string;
  byAgent: boolean;
  status: string;
  why: string;
  tampered: boolean;
}

function ActionCell({ data }: ICellRendererParams<AuditRow>) {
  return (
    <span className="cell-two">
      <b>{data?.action}</b>
      <small>{data && formatWhen(data.at)}</small>
    </span>
  );
}

function ByCell({ data }: ICellRendererParams<AuditRow>) {
  return <span className={`who ${data?.byAgent ? 'who-agent' : 'who-person'}`}>{data?.by}</span>;
}

function AuditStatusCell({ data }: ICellRendererParams<AuditRow>) {
  return data?.tampered ? <span className="status status-stop">Tampered</span> : <Status value={data?.status ?? ''} />;
}

export function AuditGrid({ rows }: { rows: AuditRow[] }) {
  const router = useRouter();
  const { ref, width } = useGridSize();
  const narrow = width < NARROW;
  const columns = useMemo<ColDef<AuditRow>[]>(
    () => [
      { field: 'action', headerName: 'Action', cellRenderer: ActionCell, minWidth: 124, flex: 1.3 },
      { field: 'amount', headerName: 'Amount', minWidth: 80, flex: 0.7, type: 'rightAligned', cellClass: RIGHT },
      { field: 'by', headerName: 'Asked by', cellRenderer: ByCell, minWidth: 130, flex: 1, hide: narrow },
      { field: 'status', headerName: 'Result', cellRenderer: AuditStatusCell, minWidth: 140, flex: 1 },
      { field: 'why', headerName: 'Why', minWidth: 200, flex: 2.2, hide: narrow, tooltipField: 'why', cellStyle: { color: 'var(--ink-2)' } },
    ],
    [narrow],
  );

  return (
    <div className="grid-clickable" ref={ref}>
      {width ? (
        <AgGridReact<AuditRow>
          theme={theme}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
          autoSizeStrategy={FIT}
          onGridSizeChanged={(e) => e.api.sizeColumnsToFit()}
          domLayout="autoHeight"
          containerStyle={{ height: 'auto' }}
          onRowClicked={(e) => e.data && router.push(`/approve/${e.data.id}`)}
          pagination={rows.length > 15}
          paginationPageSize={15}
          overlayNoRowsTemplate="No agent actions yet."
        />
      ) : (
        <GridSkeleton rows={rows.length} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Catalog: the owner edits price and stock in place. Each edit is saved through the same service the
// agent's update_variant tool uses; a refused edit snaps back, and Ctrl+Z undoes (and saves) the last one.

function ProductCell({ data }: ICellRendererParams<VariantRow>) {
  return (
    <span className="cell-two">
      <b>
        {data?.product}
        {data?.title ? <span className="soft" style={{ fontWeight: 400 }}> · {data.title}</span> : null}
      </b>
      <small className="mono">{data?.id}</small>
    </span>
  );
}

function StockStateCell({ data }: ICellRendererParams<VariantRow>) {
  if (!data) return null;
  if (data.stock === null) return <span className="status status-quiet">Made to order, {data.madeToOrderDays} days</span>;
  if (data.stock === 0) return <span className="status status-stop">Sold out</span>;
  if (data.stock <= LOW_STOCK) return <span className="status status-hold">{data.stock} left</span>;
  return <span className="status status-ok">In stock</span>;
}

const LOW_STOCK = 2;
type Feedback = { tone: 'ok' | 'error'; text: string };

/** A market reference as the owner route returns it. */
interface MarketView {
  usual_range?: string;
  median?: string;
  your_price_is?: 'below' | 'within' | 'above';
  summary: string;
}
type MarketState = MarketView | 'loading' | { error: string };
interface CatalogContext {
  market: Map<string, MarketState>;
  check: (id: string) => void;
}

const POSITION_TONE = { below: 'hold', within: 'ok', above: 'hold' } as const;

function MarketCell({ data, context }: ICellRendererParams<VariantRow, unknown, CatalogContext>) {
  if (!data) return null;
  const state = context.market.get(data.id);
  if (!state)
    return (
      <button className="btn btn-quiet btn-small" onClick={() => context.check(data.id)}>
        Compare
      </button>
    );
  if (state === 'loading') return <span className="small muted">Checking...</span>;
  if ('error' in state) return <span className="small error" title={state.error}>Unavailable</span>;
  if (!state.usual_range) return <span className="small muted" title={state.summary}>Too few listings</span>;
  return (
    <span className="cell-two" title={state.summary}>
      <span>{state.usual_range}</span>
      <small>
        median {state.median}
        {state.your_price_is ? <span className={`dot dot-${POSITION_TONE[state.your_price_is]}`}> · yours is {state.your_price_is}</span> : null}
      </small>
    </span>
  );
}

export function CatalogGrid({ rows, market: marketEnabled }: { rows: VariantRow[]; market: boolean }) {
  const { ref, width } = useGridSize();
  const narrow = width < NARROW;
  const [feedback, setFeedback] = useState<Feedback>();
  // Rows we are putting back after a refused edit: their change events are not new edits.
  const reverting = useRef(new Set<string>());
  const grid = useRef<AgGridReact<VariantRow>>(null);
  // Market references, fetched one row at a time on request: each one is a search with a cost.
  const market = useRef(new Map<string, MarketState>());
  const context = useMemo<CatalogContext>(() => {
    const show = (id: string, state: MarketState) => {
      market.current.set(id, state);
      const node = grid.current?.api.getRowNode(id);
      if (node) grid.current?.api.refreshCells({ rowNodes: [node], columns: ['market'], force: true });
    };
    return {
      market: market.current,
      check: (id) => {
        show(id, 'loading');
        fetch(`/api/owner/market?variant=${encodeURIComponent(id)}`)
          .then(async (res) => {
            const body = await res.json();
            show(id, res.ok ? (body as MarketView) : { error: body.message ?? 'Unavailable' });
          })
          .catch(() => show(id, { error: 'Network error' }));
      },
    };
  }, []);

  const columns = useMemo<ColDef<VariantRow>[]>(
    () => [
      { field: 'product', headerName: 'Product', cellRenderer: ProductCell, minWidth: 180, flex: 2, getQuickFilterText: (p) => `${p.data?.product} ${p.data?.title}` },
      {
        field: 'price',
        headerName: 'Price',
        minWidth: 104,
        flex: 0.9,
        type: 'rightAligned',
        cellClass: [...RIGHT, 'cell-editable'],
        editable: true,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: (p: { data?: VariantRow }) => ({ min: 0, precision: decimalsFor(p.data?.currency ?? 'USD'), showStepperButtons: false }),
        // The grid edits whole units ("24.5"); the shop keeps minor units.
        valueGetter: (p) => (p.data ? p.data.price / 10 ** decimalsFor(p.data.currency) : null),
        valueSetter: (p) => {
          if (!p.data || typeof p.newValue !== 'number' || !Number.isFinite(p.newValue)) return false;
          p.data.price = Math.round(p.newValue * 10 ** decimalsFor(p.data.currency));
          return true;
        },
        valueFormatter: (p) => (p.data ? formatMoney(p.data.price, p.data.currency) : ''),
      },
      {
        field: 'stock',
        headerName: 'In stock',
        minWidth: 96,
        flex: 0.8,
        type: 'rightAligned',
        cellClass: (p) => (p.data?.stock === null ? RIGHT : [...RIGHT, 'cell-editable']),
        editable: (p) => p.data?.stock !== null,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0, showStepperButtons: false },
        valueFormatter: (p) => (p.value === null ? '-' : String(p.value)),
      },
      { colId: 'state', headerName: 'Status', cellRenderer: StockStateCell, minWidth: 150, flex: 1, sortable: false, hide: narrow },
      { colId: 'market', headerName: 'Market price', cellRenderer: MarketCell, minWidth: 170, flex: 1.2, sortable: false, hide: narrow || !marketEnabled },
    ],
    [narrow, marketEnabled],
  );

  async function save(e: CellValueChangedEvent<VariantRow>) {
    const row = e.data;
    const field = e.colDef.field as 'price' | 'stock';
    if (reverting.current.delete(`${row.id}:${field}`) || e.oldValue === e.newValue) return;
    const body = field === 'price' ? { price: (row.price / 10 ** decimalsFor(row.currency)).toFixed(decimalsFor(row.currency)) } : { stock: row.stock };
    try {
      const saved = await callApi<VariantRow>(`/api/owner/variants/${encodeURIComponent(row.id)}`, 'PATCH', body);
      e.node.setData(saved);
      const what = field === 'price' ? `price is now ${formatMoney(saved.price, saved.currency)}` : `stock is now ${saved.stock}`;
      setFeedback({ tone: 'ok', text: `Saved. ${row.product}${row.title ? ` (${row.title})` : ''} ${what}.` });
    } catch (err) {
      reverting.current.add(`${row.id}:${field}`);
      e.node.setDataValue(e.column, e.oldValue);
      setFeedback({ tone: 'error', text: `Not saved: ${(err as Error).message}` });
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--s3)' }}>
      <p className={`small ${feedback?.tone === 'error' ? 'error' : 'soft'}`} role="status" aria-live="polite">
        {feedback?.text ?? 'Double-click a price or a stock count to change it. Enter saves, Esc cancels, Ctrl+Z undoes.'}
      </p>
      <div ref={ref}>
        {width ? (
          <AgGridReact<VariantRow>
            ref={grid}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            context={context}
            getRowId={(p) => p.data.id}
            defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
            autoSizeStrategy={FIT}
            onGridSizeChanged={(e) => e.api.sizeColumnsToFit()}
            domLayout="autoHeight"
            containerStyle={{ height: 'auto' }}
            singleClickEdit={false}
            stopEditingWhenCellsLoseFocus
            undoRedoCellEditing
            undoRedoCellEditingLimit={20}
            onCellValueChanged={save}
          />
        ) : (
          <GridSkeleton rows={rows.length} />
        )}
      </div>
    </div>
  );
}
