import React, { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  ModuleRegistry,
  AllCommunityModule,
  themeQuartz,
  colorSchemeDark,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type RowClickedEvent,
  type ICellRendererParams,
} from 'ag-grid-community';
import type { Invoice } from '../types';
import { CheckCircle2, CreditCard, Circle } from 'lucide-react';

ModuleRegistry.registerModules([AllCommunityModule]);

// A dark AG Grid theme built from the app's own CSS tokens (see index.css)
// rather than a stock theme, so the portfolio table reads as part of the
// same ledger-panel design language instead of a bolted-on widget.
const collectAiGridTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  accentColor: '#FFD23F', // --gold
  backgroundColor: '#121826', // --surface
  dataBackgroundColor: '#121826', // --surface
  foregroundColor: '#F1F5F9', // --text-primary
  textColor: '#F1F5F9', // --text-primary
  borderColor: '#1C2536', // --border-subtle
  headerBackgroundColor: '#0B0F19', // --surface-inset
  headerTextColor: '#5C6B85', // --text-muted
  rowHoverColor: 'rgba(255, 210, 63, 0.06)',
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  borderRadius: 8,
  spacing: 6,
});

const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN');

const StatusCell: React.FC<ICellRendererParams<Invoice>> = (params) => {
  const inv = params.data;
  if (!inv) return null;
  if (inv.status === 'paid') {
    const viaPaypal = inv.paid_via === 'paypal';
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: viaPaypal ? '#0070BA' : 'var(--healthy)',
        }}
        title={viaPaypal ? 'Closed automatically by a real PayPal webhook event' : 'Marked paid manually'}
      >
        {viaPaypal ? <CreditCard size={12} /> : <CheckCircle2 size={12} />}
        {viaPaypal ? 'PAID · PAYPAL' : 'PAID · MANUAL'}
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: 'var(--text-secondary)',
      }}
    >
      <Circle size={8} fill="var(--gold)" color="var(--gold)" />
      ACTIVE
    </span>
  );
};

interface InvoiceGridProps {
  invoices: Invoice[];
  selectedInvoiceId?: string | null;
  onSelectInvoice: (inv: Invoice) => void;
  paypalConfigured: boolean;
}

export const InvoiceGrid: React.FC<InvoiceGridProps> = ({
  invoices,
  selectedInvoiceId,
  onSelectInvoice,
  paypalConfigured,
}) => {
  const gridApiRef = useRef<GridApi<Invoice> | null>(null);

  const columnDefs = useMemo<ColDef<Invoice>[]>(
    () => [
      {
        field: 'invoice_id',
        headerName: 'Invoice',
        pinned: 'left',
        width: 130,
        cellClass: 'mono-data',
      },
      {
        field: 'client_name',
        headerName: 'Client',
        flex: 1.3,
        minWidth: 160,
      },
      {
        field: 'amount',
        headerName: 'Amount',
        type: 'numericColumn',
        width: 140,
        valueFormatter: (p) => (typeof p.value === 'number' ? fmtINR(p.value) : ''),
        cellClass: 'mono-data',
      },
      {
        field: 'days_overdue',
        headerName: 'Days Overdue',
        width: 140,
        type: 'numericColumn',
        cellClass: 'mono-data',
        cellStyle: (p) => ({
          color: (p.value ?? 0) > 30 ? 'var(--critical)' : (p.value ?? 0) > 10 ? 'var(--warning)' : 'var(--text-primary)',
          fontWeight: 600,
        }),
      },
      {
        field: 'ignored_reminders',
        headerName: 'Ignored',
        width: 110,
        type: 'numericColumn',
        cellClass: 'mono-data',
      },
      {
        field: 'relationship_score',
        headerName: 'Relationship',
        width: 130,
        type: 'numericColumn',
        cellClass: 'mono-data',
        valueFormatter: (p) => (typeof p.value === 'number' ? `${p.value}/100` : ''),
      },
      {
        field: 'historical_on_time_rate',
        headerName: 'On-Time %',
        width: 140,
        type: 'numericColumn',
        cellClass: 'mono-data',
        valueFormatter: (p) => (typeof p.value === 'number' ? `${Math.round(p.value * 100)}%` : ''),
      },
      {
        headerName: 'Status',
        width: 160,
        cellRenderer: StatusCell,
        sortable: false,
        filter: false,
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
    }),
    []
  );

  const onGridReady = (params: GridReadyEvent<Invoice>) => {
    gridApiRef.current = params.api;
  };

  const onRowClicked = (e: RowClickedEvent<Invoice>) => {
    if (e.data) onSelectInvoice(e.data);
  };

  // Keep the grid's native row-selection highlight in sync with whichever
  // invoice the rest of the dashboard currently has selected, rather than
  // letting AG Grid's own click-selection be the only source of truth —
  // selecting a new/other invoice elsewhere in the UI should visibly move
  // the highlighted row too.
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    api.forEachNode((node) => {
      const shouldSelect = !!selectedInvoiceId && node.data?.invoice_id === selectedInvoiceId;
      if (node.isSelected() !== shouldSelect) node.setSelected(shouldSelect);
    });
  }, [selectedInvoiceId, invoices]);

  return (
    <section className="ledger-panel reveal d1" style={{ padding: '22px 24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <div className="mono-label" style={{ marginBottom: 4 }}>
            Portfolio Overview
          </div>
          <h2 className="display-title" style={{ fontSize: '1.1rem' }}>
            All Invoices Under Management
          </h2>
        </div>
        <span className={`badge ${paypalConfigured ? 'badge-healthy' : 'badge-neutral'}`}>
          <CreditCard size={12} />
          PayPal {paypalConfigured ? 'Sandbox Connected' : 'Not Configured'}
        </span>
      </div>

      <div style={{ height: Math.min(56 * Math.max(invoices.length, 1) + 56, 420) }}>
        <AgGridReact<Invoice>
          theme={collectAiGridTheme}
          rowData={invoices}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.invoice_id}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          onGridReady={onGridReady}
          onRowClicked={onRowClicked}
          animateRows
        />
      </div>
    </section>
  );
};

export default InvoiceGrid;
