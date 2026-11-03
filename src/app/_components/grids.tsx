'use client';

// AG Grid (Community) views for the owner dashboard: orders and the say-so audit trail. Rows are
// plain serializable objects prepared on the server.

import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo, useRef, useState } from 'react';

ModuleRegistry.registerModules([AllCommunityModule]);

// Follows the site's light/dark tokens instead of a fixed palette.
const theme = themeQuartz.withParams({
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--fg)',
  borderColor: 'var(--line)',
  headerBackgroundColor: 'var(--bg)',
  accentColor: 'var(--accent)',
  fontFamily: 'inherit',
  fontSize: 14,
  wrapperBorderRadius: 12,
});

export interface OrderRow {
  id: string;
  number: string;
  created: string;
  status: string;
  total: string;
  totalMinor: number;
  refunded: string;
  items: string;
  buyer: string;
  via: string;
  tracking: string;
}

export interface AuditRow {
  id: string;
  at: string;
  action: string;
  amount: string;
  by: string;
  status: string;
  why: string;
  chain: 'intact' | 'tampered';
}

function Pill({ value }: ICellRendererParams) {
  return <span className={`pill ${value}`}>{String(value ?? '').replace('_', ' ')}</span>;
}

export function OrdersGrid({ rows }: { rows: OrderRow[] }) {
  const grid = useRef<AgGridReact<OrderRow>>(null);
  const [filter, setFilter] = useState('');
  const columns = useMemo<ColDef<OrderRow>[]>(
    () => [
      { field: 'number', headerName: 'Order', minWidth: 140 },
      { field: 'created', headerName: 'Placed', sort: 'desc', minWidth: 150 },
      { field: 'status', cellRenderer: Pill, minWidth: 140 },
      { field: 'total', comparator: (_a, _b, x, y) => (x.data?.totalMinor ?? 0) - (y.data?.totalMinor ?? 0), minWidth: 100 },
      { field: 'refunded', minWidth: 100 },
      { field: 'items', flex: 2, minWidth: 200 },
      { field: 'buyer', minWidth: 160 },
      { field: 'via', headerName: 'Agent / channel', minWidth: 140 },
      { field: 'tracking', minWidth: 140 },
    ],
    [],
  );
  return (
    <div className="stack">
      <div className="row">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search orders" style={{ flex: 1, minWidth: 160 }} />
        <button onClick={() => grid.current?.api.exportDataAsCsv({ fileName: 'sayso-orders.csv' })}>Export CSV</button>
      </div>
      <AgGridReact<OrderRow>
        ref={grid}
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ flex: 1, sortable: true, filter: true, resizable: true }}
        quickFilterText={filter}
        domLayout="autoHeight"
        pagination={rows.length > 20}
        paginationPageSize={20}
        overlayNoRowsTemplate="No orders yet. Share your shop's MCP link with an AI assistant to get the first one."
      />
    </div>
  );
}

export function AuditGrid({ rows }: { rows: AuditRow[] }) {
  const columns = useMemo<ColDef<AuditRow>[]>(
    () => [
      { field: 'at', headerName: 'When', sort: 'desc', minWidth: 150 },
      { field: 'action', minWidth: 140 },
      { field: 'amount', minWidth: 100 },
      { field: 'by', headerName: 'Asked by', minWidth: 160 },
      { field: 'status', cellRenderer: Pill, minWidth: 140 },
      { field: 'why', headerName: 'Why', flex: 2, minWidth: 220, tooltipField: 'why' },
      {
        field: 'chain',
        headerName: 'Audit chain',
        minWidth: 120,
        cellRenderer: ({ value }: ICellRendererParams) => <span className={value === 'intact' ? 'ok' : 'error'}>{value}</span>,
      },
      {
        field: 'id',
        headerName: '',
        minWidth: 110,
        sortable: false,
        filter: false,
        cellRenderer: ({ value }: ICellRendererParams) => <a href={`/approve/${value}`}>details</a>,
      },
    ],
    [],
  );
  return (
    <AgGridReact<AuditRow>
      theme={theme}
      rowData={rows}
      columnDefs={columns}
      defaultColDef={{ flex: 1, sortable: true, filter: true, resizable: true }}
      domLayout="autoHeight"
      pagination={rows.length > 15}
      paginationPageSize={15}
      overlayNoRowsTemplate="No agent actions yet."
    />
  );
}
