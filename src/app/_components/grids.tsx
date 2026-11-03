'use client';

// AG Grid (Community) views for the owner area. Columns fit the container (no sideways scrolling):
// secondary columns hide on narrow screens, and a row opens its detail page.

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GridApi, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Status } from './ui.tsx';

ModuleRegistry.registerModules([AllCommunityModule]);

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

/** AG Grid measures the page, so it renders only in the browser; a skeleton holds its place. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function GridSkeleton({ rows }: { rows: number }) {
  return <div className="grid-skeleton" style={{ height: 42 + Math.max(1, Math.min(rows, 15)) * 58 }} aria-hidden="true" />;
}

const RIGHT = ['ag-right-aligned-cell', 'num'];

/** Show only the columns that fit; the rest stay one click away on the detail page. */
function fitColumns(api: GridApi, narrowHidden: string[], width: number) {
  api.setColumnsVisible(narrowHidden, width >= 720);
  api.sizeColumnsToFit();
}

export interface OrderRow {
  id: string;
  number: string;
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
      <small>{data?.placed}</small>
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
  const narrow = useMemo(() => ['items', 'refunded'], []);
  const columns = useMemo<ColDef<OrderRow>[]>(
    () => [
      { field: 'number', headerName: 'Order', cellRenderer: OrderCell, minWidth: 120, flex: 1.2, getQuickFilterText: (p) => `${p.data?.number} ${p.data?.placed}` },
      { field: 'status', cellRenderer: StatusCell, minWidth: 104, flex: 1 },
      { field: 'items', headerName: 'Items', cellRenderer: ItemsCell, minWidth: 180, flex: 2.2, getQuickFilterText: (p) => `${p.data?.items} ${p.data?.via}` },
      { field: 'refunded', headerName: 'Refunded', minWidth: 96, flex: 0.8, type: 'rightAligned', cellClass: RIGHT },
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
    [],
  );
  const onSize = useCallback((e: { api: GridApi; clientWidth: number }) => fitColumns(e.api, narrow, e.clientWidth), [narrow]);
  const mounted = useMounted();

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
      <div className="grid-clickable">
        {mounted ? (
          <AgGridReact<OrderRow>
            ref={grid}
            theme={theme}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
            quickFilterText={filter}
            domLayout="autoHeight"
            containerStyle={{ height: 'auto' }}
            onGridSizeChanged={onSize}
            onFirstDataRendered={(e) => fitColumns(e.api, narrow, window.innerWidth)}
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
      <small>{data?.at}</small>
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
  const narrow = useMemo(() => ['by', 'why'], []);
  const columns = useMemo<ColDef<AuditRow>[]>(
    () => [
      { field: 'action', headerName: 'Action', cellRenderer: ActionCell, minWidth: 124, flex: 1.3 },
      { field: 'amount', headerName: 'Amount', minWidth: 80, flex: 0.7, type: 'rightAligned', cellClass: RIGHT },
      { field: 'by', headerName: 'Asked by', cellRenderer: ByCell, minWidth: 130, flex: 1 },
      { field: 'status', headerName: 'Result', cellRenderer: AuditStatusCell, minWidth: 104, flex: 0.9 },
      { field: 'why', headerName: 'Why', minWidth: 200, flex: 2.2, tooltipField: 'why', cellStyle: { color: 'var(--ink-2)' } },
    ],
    [],
  );
  const onSize = useCallback((e: { api: GridApi; clientWidth: number }) => fitColumns(e.api, narrow, e.clientWidth), [narrow]);
  const mounted = useMounted();
  if (!mounted) return <GridSkeleton rows={rows.length} />;

  return (
    <div className="grid-clickable">
      <AgGridReact<AuditRow>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, resizable: false, suppressMovable: true }}
        domLayout="autoHeight"
        containerStyle={{ height: 'auto' }}
        onGridSizeChanged={onSize}
        onFirstDataRendered={(e) => fitColumns(e.api, narrow, window.innerWidth)}
        onRowClicked={(e) => e.data && router.push(`/approve/${e.data.id}`)}
        pagination={rows.length > 15}
        paginationPageSize={15}
        overlayNoRowsTemplate="No agent actions yet."
      />
    </div>
  );
}
