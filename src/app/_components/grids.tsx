'use client';

// AG Grid (Community) views for the owner area. Columns fit the container (no sideways scrolling):
// secondary columns hide on narrow screens. Order rows open their detail page, activity rows their
// receipt in a modal; the catalog is edited in place.

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
  TextEditorModule,
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
import { formatMoney, parseAmount, toMoney } from '@/core/money.ts';
import { callApi } from './api.ts';
import type { PayPalCheck } from '@/core/record-view.ts';
import { ProductEditDialog, type EditableProduct } from './catalog-editor.tsx';
import { ChannelBadge, Thumb } from './owner-bits.tsx';
import { RecordModal } from './record-modal.tsx';
import { formatWhen } from './time.tsx';
import { Status } from './ui.tsx';
import { OUTCOME_TONE, type Outcome } from '@/core/trust-report.ts';

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
  TextEditorModule,
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
  refundedMinor: number;
  items: string;
  /** The order's channel id (mcp, sayso-assistant, sayso-cart, owner-agent...). */
  via: string;
  buyer?: string;
  /** The first piece's photo. */
  image?: string;
  /** Carrier and tracking number once shipped. */
  shipping?: string;
  /** The buyer has a dispute open in PayPal. */
  dispute?: boolean;
}

/** The quick views over the orders: what usually needs doing first. */
const ORDER_VIEWS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'ship', label: 'To ship', test: (r: OrderRow) => r.status === 'paid' && !r.shipping },
  { id: 'waiting', label: 'Waiting for you', test: (r: OrderRow) => r.status === 'awaiting_owner' },
  { id: 'refunded', label: 'Refunded', test: (r: OrderRow) => r.refundedMinor > 0 },
  { id: 'dispute', label: 'Disputes', test: (r: OrderRow) => Boolean(r.dispute) },
] as const;

function OrderCell({ data }: ICellRendererParams<OrderRow>) {
  return (
    <span className="cell-media">
      <Thumb src={data?.image} />
      <span className="cell-two">
        <b className="mono">{data?.number}</b>
        <small>
          {data && formatWhen(data.placed)}
          {data?.dispute && <span className="status status-stop cell-flag">Dispute</span>}
        </small>
      </span>
    </span>
  );
}

function ItemsCell({ data }: ICellRendererParams<OrderRow>) {
  return (
    <span className="cell-two">
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{data?.items}</span>
      {data?.buyer && <small>{data.buyer}</small>}
    </span>
  );
}

function ChannelCell({ data }: ICellRendererParams<OrderRow>) {
  return <ChannelBadge channel={data?.via} />;
}

function ShippingCell({ data }: ICellRendererParams<OrderRow>) {
  if (!data) return null;
  if (data.shipping) return <span className="small">{data.shipping}</span>;
  return data.status === 'paid' ? <span className="status status-hold">To ship</span> : <span className="small muted">-</span>;
}

function RefundCell({ data }: ICellRendererParams<OrderRow>) {
  return data && data.refundedMinor > 0 ? <span className="num refund">−{data.refunded}</span> : <span className="muted">-</span>;
}

function StatusCell({ value }: ICellRendererParams) {
  return <Status value={String(value ?? '')} />;
}

export function OrdersGrid({ rows }: { rows: OrderRow[] }) {
  const router = useRouter();
  const openOrder = (id: string) => router.push(`/owner/orders/${id}`);
  const grid = useRef<AgGridReact<OrderRow>>(null);
  const [filter, setFilter] = useState('');
  const [viewId, setViewId] = useState<(typeof ORDER_VIEWS)[number]['id']>('all');
  const shown = useMemo(() => rows.filter(ORDER_VIEWS.find((v) => v.id === viewId)!.test), [rows, viewId]);
  const { ref, width } = useGridSize();
  const narrow = width < NARROW;
  const columns = useMemo<ColDef<OrderRow>[]>(
    () => [
      { field: 'number', headerName: 'Order', cellRenderer: OrderCell, minWidth: narrow ? 166 : 190, flex: 1.3, getQuickFilterText: (p) => `${p.data?.number} ${p.data ? formatWhen(p.data.placed) : ''}` },
      { field: 'items', headerName: 'Items', cellRenderer: ItemsCell, minWidth: 180, flex: 2, hide: narrow, getQuickFilterText: (p) => `${p.data?.items} ${p.data?.buyer ?? ''} ${p.data?.via}` },
      { field: 'via', headerName: 'Channel', cellRenderer: ChannelCell, minWidth: 140, flex: 1, hide: narrow },
      { field: 'status', cellRenderer: StatusCell, minWidth: narrow ? 88 : 120, flex: 0.9 },
      { field: 'shipping', headerName: 'Shipping', cellRenderer: ShippingCell, minWidth: 120, flex: 1, hide: narrow, sortable: false },
      { field: 'refunded', headerName: 'Refunded', cellRenderer: RefundCell, minWidth: 96, flex: 0.7, hide: narrow, type: 'rightAligned', cellClass: RIGHT, comparator: (_a, _b, x, y) => (x.data?.refundedMinor ?? 0) - (y.data?.refundedMinor ?? 0) },
      {
        field: 'total',
        headerName: 'Total',
        minWidth: 92,
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
      <div className="row grid-toolbar">
        <div className="dock-tabs" role="group" aria-label="Show orders">
          {/* Disputes only when there are some: no empty filter for something that rarely happens. */}
          {ORDER_VIEWS.filter((v) => v.id !== 'dispute' || rows.some(v.test)).map((v) => {
            const n = rows.filter(v.test).length;
            return (
              <button key={v.id} type="button" aria-pressed={viewId === v.id} className="dock-tab" onClick={() => setViewId(v.id)}>
                {v.label}
                {v.id !== 'all' && n > 0 && <span className="dock-tab-count">{n}</span>}
              </button>
            );
          })}
        </div>
        <label htmlFor="order-search" className="sr-only">
          Search orders
        </label>
        <input id="order-search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search orders, pieces, buyers" style={{ flex: 1, minWidth: 180 }} />
        <button className="btn" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: 'sayso-orders.csv', columnKeys: ['number', 'items', 'via', 'status', 'shipping', 'refunded', 'total'] })}>
          Export CSV
        </button>
      </div>
      <div className="grid-clickable" ref={ref}>
        {width ? (
          <AgGridReact<OrderRow>
            ref={grid}
            theme={theme}
            rowData={shown}
            columnDefs={columns}
            rowHeight={64}
            defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
            autoSizeStrategy={FIT}
            onGridSizeChanged={(e) => e.api.sizeColumnsToFit()}
            quickFilterText={filter}
            domLayout="autoHeight"
            containerStyle={{ height: 'auto' }}
            // The whole row opens the order, by mouse, or with Enter on any of its cells.
            onRowClicked={(e) => e.data && openOrder(e.data.id)}
            onCellKeyDown={(e) => e.data && (e.event as KeyboardEvent | null)?.key === 'Enter' && openOrder(e.data.id)}
            pagination={rows.length > 20}
            paginationPageSize={20}
            paginationPageSizeSelector={[20, 50, 100]}
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
  /** Nothing moved (blocked, turned down, failed): the amount is struck through. */
  stopped: boolean;
  by: string;
  byAgent: boolean;
  status: string;
  /** Why, as things stand now (see whyNow). */
  why: string;
  tampered: boolean;
  /** What happened, in the owner's words (Allowed by your rules, You said OK, Waiting for you...). */
  outcome: Outcome;
  paypal: PayPalCheck;
}

function AmountCell({ data }: ICellRendererParams<AuditRow>) {
  if (!data?.amount) return null;
  return data.stopped ? (
    <span className="cell-stopped" title="Nothing moved">
      {data.amount}
    </span>
  ) : (
    <>{data.amount}</>
  );
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
  if (!data) return null;
  if (data.tampered) return <span className="status status-stop">Edited after the fact</span>;
  return <span className={`status status-${OUTCOME_TONE[data.outcome]}`}>{data.outcome}</span>;
}

const PAYPAL_CHECK: Record<PayPalCheck, { mark: string; className: string; title: string }> = {
  ok: { mark: '✓', className: 'check-ok', title: 'Read back from PayPal' },
  bad: { mark: '!', className: 'check-bad', title: 'PayPal did not confirm it' },
  sent: { mark: '…', className: 'check-none', title: 'Sent to PayPal, waiting for the read-back' },
  none: { mark: '–', className: 'check-none', title: 'Nothing went to PayPal' },
};

/** Two checks every money move gets: PayPal read it back, and its record's hash chain still holds. */
function ChecksCell({ data }: ICellRendererParams<AuditRow>) {
  if (!data) return null;
  const paypal = PAYPAL_CHECK[data.paypal];
  return (
    <span className="checks">
      <span className={paypal.className} title={paypal.title}>
        PayPal {paypal.mark}
      </span>
      <span className={data.tampered ? 'check-bad' : 'check-ok'} title={data.tampered ? 'This record was edited after the fact' : 'Hash chain intact'}>
        Chain {data.tampered ? '!' : '✓'}
      </span>
    </span>
  );
}

export function AuditGrid({ rows }: { rows: AuditRow[] }) {
  const router = useRouter();
  const { ref, width } = useGridSize();
  const narrow = width < NARROW;
  const [open, setOpen] = useState<string>();
  // Records change while the owner is elsewhere (a buyer asks for a refund, they answer on their phone):
  // coming back to this tab shows them as they are now.
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && router.refresh();
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [router]);
  const columns = useMemo<ColDef<AuditRow>[]>(
    () => [
      { field: 'action', headerName: 'Action', cellRenderer: ActionCell, minWidth: 124, flex: 1.3 },
      { field: 'amount', headerName: 'Amount', cellRenderer: AmountCell, minWidth: 80, flex: 0.7, type: 'rightAligned', cellClass: RIGHT },
      { field: 'by', headerName: 'Asked by', cellRenderer: ByCell, minWidth: 180, flex: 1.1, hide: narrow, tooltipField: 'by' },
      { field: 'outcome', headerName: 'Outcome', cellRenderer: AuditStatusCell, minWidth: 196, flex: 1.1 },
      { colId: 'checks', headerName: 'Checks', cellRenderer: ChecksCell, minWidth: 168, flex: 0.8, sortable: false, hide: narrow },
      { field: 'why', headerName: 'Why', minWidth: 200, flex: 2, hide: narrow, tooltipField: 'why', cellStyle: { color: 'var(--ink-2)' } },
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
          // The whole row opens the record, by mouse, or with Enter on any of its cells.
          onRowClicked={(e) => e.data && setOpen(e.data.id)}
          onCellKeyDown={(e) => e.data && (e.event as KeyboardEvent | null)?.key === 'Enter' && setOpen(e.data.id)}
          getRowId={(p) => p.data.id}
          pagination={rows.length > 15}
          paginationPageSize={15}
          paginationPageSizeSelector={[15, 50, 100]}
          overlayNoRowsTemplate="No agent actions yet."
        />
      ) : (
        <GridSkeleton rows={rows.length} />
      )}
      {open && <RecordModal id={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Catalog: the owner edits price and stock in place. Each edit is saved through the same service the
// agent's update_variant tool uses; a refused edit snaps back, and Ctrl+Z undoes (and saves) the last one.

function ProductCell({ data }: ICellRendererParams<VariantRow>) {
  return (
    <span className="cell-media">
      <Thumb src={data?.image} />
      <span className="cell-two">
        <b>{data?.product}</b>
        <small>
          {data?.title ? `${data.title} · ` : ''}
          <span className="mono">{data?.id}</span>
        </small>
      </span>
    </span>
  );
}

function PayPalCell({ data }: ICellRendererParams<VariantRow>) {
  return data?.inPayPal ? <span className="status status-ok" title="Registered in PayPal's catalog">In PayPal</span> : <span className="status status-quiet">Not yet</span>;
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
  /** Opens the whole product (name, description, photo, options) to edit. */
  edit?: (productId: string) => void;
}

function EditCell({ data, context }: ICellRendererParams<VariantRow, unknown, CatalogContext>) {
  if (!data || !context.edit) return null;
  return (
    <button type="button" className="btn btn-quiet btn-small" onClick={() => context.edit!(data.productId)}>
      Edit
    </button>
  );
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

/** `readOnly`: the shared demo shop, where nobody can change prices or stock. */
/** `products`: the full products of these rows, for the Edit button (left out when read-only). */
export function CatalogGrid({ rows, market: marketEnabled, readOnly = false, products = [], currency = 'USD' }: { rows: VariantRow[]; market: boolean; readOnly?: boolean; products?: EditableProduct[]; currency?: string }) {
  const [editing, setEditing] = useState<string>();
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
      ...(readOnly ? {} : { edit: (productId: string) => setEditing(productId) }),
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
  }, [readOnly]);

  const columns = useMemo<ColDef<VariantRow>[]>(
    () => [
      { field: 'product', headerName: 'Product', cellRenderer: ProductCell, minWidth: narrow ? 150 : 180, flex: 2, getQuickFilterText: (p) => `${p.data?.product} ${p.data?.title}` },
      {
        field: 'price',
        headerName: 'Price',
        minWidth: narrow ? 92 : 104,
        flex: 0.9,
        type: 'rightAligned',
        cellClass: readOnly ? RIGHT : [...RIGHT, 'cell-editable'],
        cellClassRules: { 'cell-confirm': (p) => Boolean(p.data?.toConfirm) },
        editable: !readOnly,
        cellEditor: 'agTextCellEditor',
        // The owner types an amount ("24.50", "$1,200"); it is read with the same parser the server uses,
        // into minor units, so no float ever touches a price.
        valueGetter: (p) => (p.data ? toMoney(p.data.price, p.data.currency).value : null),
        valueSetter: (p) => {
          if (!p.data) return false;
          const minor = parseAmount(String(p.newValue ?? ''), p.data.currency);
          if (!minor) {
            setFeedback({ tone: 'error', text: `Not saved: a price looks like 24.00 (${p.data.currency}).` });
            return false;
          }
          p.data.price = minor;
          return true;
        },
        valueFormatter: (p) => (p.data ? `${formatMoney(p.data.price, p.data.currency)}${p.data.toConfirm ? ' · to confirm' : ''}` : ''),
        tooltipValueGetter: (p) => (p.data?.toConfirm ? 'Sayso suggested this price from similar items. Set your own, or keep it from the overview.' : undefined),
      },
      {
        field: 'stock',
        headerName: 'In stock',
        minWidth: narrow ? 84 : 96,
        flex: 0.8,
        type: 'rightAligned',
        cellClass: (p) => (readOnly || p.data?.stock === null ? RIGHT : [...RIGHT, 'cell-editable']),
        editable: (p) => !readOnly && p.data?.stock !== null,
        cellEditor: 'agNumberCellEditor',
        cellEditorParams: { min: 0, precision: 0, showStepperButtons: false },
        valueFormatter: (p) => (p.value === null ? '-' : String(p.value)),
      },
      { colId: 'state', headerName: 'Status', cellRenderer: StockStateCell, minWidth: 196, flex: 1.1, sortable: false, hide: narrow },
      { field: 'sold', headerName: 'Sold · 14d', headerTooltip: 'Units sold in the last 14 days', minWidth: 104, flex: 0.7, hide: narrow, type: 'rightAligned', cellClass: RIGHT, valueFormatter: (p) => (p.value ? String(p.value) : '-') },
      { colId: 'paypal', headerName: 'PayPal catalog', cellRenderer: PayPalCell, minWidth: 130, flex: 0.8, sortable: false, hide: narrow },
      { colId: 'market', headerName: 'Market price', cellRenderer: MarketCell, minWidth: 170, flex: 1.2, sortable: false, hide: narrow || !marketEnabled },
      { colId: 'edit', headerName: '', cellRenderer: EditCell, minWidth: 92, flex: 0.6, sortable: false, hide: readOnly, cellClass: RIGHT },
    ],
    [narrow, marketEnabled, readOnly],
  );

  async function save(e: CellValueChangedEvent<VariantRow>) {
    const row = e.data;
    const field = e.colDef.field as 'price' | 'stock';
    if (reverting.current.delete(`${row.id}:${field}`) || e.oldValue === e.newValue) return;
    const body = field === 'price' ? { price: toMoney(row.price, row.currency).value } : { stock: row.stock, expected_stock: e.oldValue };
    try {
      const saved = await callApi<VariantRow>(`/api/owner/variants/${encodeURIComponent(row.id)}`, 'PATCH', body);
      e.node.setData({ ...saved, sold: row.sold });
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
        {feedback?.text ?? (readOnly ? 'The demo shop is shared, so its prices and stock stay put. Start the judges’ tour to change your own copy.' : 'Double-click a price or a stock count to change it. Enter saves, Esc cancels, Ctrl+Z undoes.')}
      </p>
      <div ref={ref}>
        {width ? (
          <AgGridReact<VariantRow>
            ref={grid}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            rowHeight={64}
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
      {editing && products.some((p) => p.id === editing) && (
        <ProductEditDialog key={editing} product={products.find((p) => p.id === editing)!} currency={currency} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}
