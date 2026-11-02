import React, { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type RowClickedEvent,
  type ICellRendererParams,
} from 'ag-grid-community';
import type { Invoice } from '../types';

ModuleRegistry.registerModules([AllCommunityModule]);

/* The table has to read as part of the yellow field, not as a widget dropped
   onto it: acid background, black rules, inverted black header. */
const gridTheme = themeQuartz.withParams({
  accentColor: '#000000',
  backgroundColor: '#D9FB5F',
  dataBackgroundColor: '#D9FB5F',
  foregroundColor: '#000000',
  textColor: '#000000',
  borderColor: 'rgba(0,0,0,0.20)',
  headerBackgroundColor: '#000000',
  headerTextColor: '#D9FB5F',
  rowHoverColor: 'rgba(0,0,0,0.07)',
  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  borderRadius: 0,
  spacing: 7,
});

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

const StatusCell: React.FC<ICellRendererParams<Invoice>> = ({ data }) => {
  if (!data) return null;
  if (data.status === 'paid') {
    const byPaypal = data.paid_via === 'paypal';
    return (
      <span
        className="tag tag--paid"
        title={byPaypal ? 'Closed automatically by a PayPal webhook' : 'Marked paid by hand'}
      >
        {byPaypal ? 'Paid via PayPal' : 'Paid'}
      </span>
    );
  }
  return <span className="tag" style={{ opacity: 0.75 }}>Chasing</span>;
};

interface InvoiceGridProps {
  invoices: Invoice[];
  selectedInvoiceId?: string | null;
  onSelectInvoice: (inv: Invoice) => void;
}

export const InvoiceGrid: React.FC<InvoiceGridProps> = ({
  invoices,
  selectedInvoiceId,
  onSelectInvoice,
}) => {
  const gridApiRef = useRef<GridApi<Invoice> | null>(null);

  const columnDefs = useMemo<ColDef<Invoice>[]>(
    () => [
      { field: 'invoice_id', headerName: 'Invoice', pinned: 'left', width: 128 },
      { field: 'client_name', headerName: 'Client', flex: 1.3, minWidth: 160 },
      {
        field: 'amount',
        headerName: 'Amount due',
        type: 'numericColumn',
        width: 144,
        valueFormatter: (p) => (typeof p.value === 'number' ? inr(p.value) : ''),
      },
      {
        field: 'days_overdue',
        headerName: 'Days late',
        type: 'numericColumn',
        width: 128,
        // Badly overdue is called out with a fill, not a hue: there is no
        // red in this palette, and pink as type on tonic is unreadable.
        cellStyle: (p) =>
          (p.value ?? 0) > 30
            ? { background: '#FF7BB5', color: '#000000', fontWeight: 800 }
            : { background: 'transparent', color: 'inherit', fontWeight: 400 },
      },
      { field: 'ignored_reminders', headerName: 'Ignored', type: 'numericColumn', width: 112 },
      {
        field: 'relationship_score',
        headerName: 'Standing',
        type: 'numericColumn',
        width: 124,
        valueFormatter: (p) => (typeof p.value === 'number' ? `${p.value}/100` : ''),
      },
      {
        field: 'historical_on_time_rate',
        headerName: 'Pays on time',
        type: 'numericColumn',
        width: 142,
        valueFormatter: (p) => (typeof p.value === 'number' ? `${Math.round(p.value * 100)}%` : ''),
      },
      { headerName: 'Status', width: 168, cellRenderer: StatusCell, sortable: false, filter: false },
    ],
    []
  );

  // Sorting earns its place on a receivables list; per-column filter menus just
  // litter every header with a funnel icon for a table this size.
  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, filter: false, resizable: true, suppressHeaderMenuButton: true }),
    []
  );

  const onGridReady = (params: GridReadyEvent<Invoice>) => {
    gridApiRef.current = params.api;
  };

  const onRowClicked = (e: RowClickedEvent<Invoice>) => {
    if (e.data) onSelectInvoice(e.data);
  };

  // Keep the grid's own highlight in step with whatever the rest of the page
  // has selected, so picking an invoice elsewhere visibly moves the row too.
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    api.forEachNode((node) => {
      const should = !!selectedInvoiceId && node.data?.invoice_id === selectedInvoiceId;
      if (node.isSelected() !== should) node.setSelected(should);
    });
  }, [selectedInvoiceId, invoices]);

  return (
    <div
      className="grid-shell"
      style={{ height: Math.min(54 * Math.max(invoices.length, 1) + 50, 440) }}
    >
      <AgGridReact<Invoice>
        theme={gridTheme}
        rowData={invoices}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={(p) => p.data.invoice_id}
        rowHeight={54}
        headerHeight={46}
        rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
        onGridReady={onGridReady}
        onRowClicked={onRowClicked}
        overlayNoRowsTemplate="Nothing in the ledger yet. Add an invoice to get started."
        animateRows
      />
    </div>
  );
};

export default InvoiceGrid;
