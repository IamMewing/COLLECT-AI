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

/* Under the old palette the table WAS the field — mint ground, black rules —
   because mint was light enough to read dense figures on. Ultramarine isn't:
   it's the loudest colour here, and a column of ₹ figures on it is a fight.
   So the table inverts into an ink panel laid onto the field, with the header
   carrying the field's blue so the two still read as one object, and lime
   doing the accent work (header type, selection, sort icons). */
const gridTheme = themeQuartz.withParams({
  accentColor: '#CCFF00',
  backgroundColor: '#0A0A0A',
  dataBackgroundColor: '#0A0A0A',
  foregroundColor: '#F4F4EF',
  textColor: '#F4F4EF',
  borderColor: 'rgba(244,244,239,0.16)',
  headerBackgroundColor: '#1B00FF',
  headerTextColor: '#CCFF00',
  rowHoverColor: 'rgba(204,255,0,0.10)',
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
        // Badly overdue is called out with a fill, not a hue: there is no red
        // in this palette, and flare as type on ink is too dark to read.
        cellStyle: (p) =>
          (p.value ?? 0) > 30
            ? { background: '#FF0078', color: '#0A0A0A', fontWeight: 800 }
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
