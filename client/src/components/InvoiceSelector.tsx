import React from 'react';
import type { Invoice } from '../types';
import { Play, Sparkles } from 'lucide-react';

interface InvoiceSelectorProps {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  onSelectInvoice: (inv: Invoice) => void;
  onRunSweep: (inv: Invoice) => void;
  isSweeping: boolean;
}

export const InvoiceSelector: React.FC<InvoiceSelectorProps> = ({
  invoices,
  selectedInvoice,
  onSelectInvoice,
  onRunSweep,
  isSweeping,
}) => {
  if (!selectedInvoice) return null;

  return (
    <div className="os-card" style={{ padding: '24px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <span className="label-text">Select Seed Scenario or Invoice</span>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.4rem',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              marginTop: '4px',
            }}
          >
            {selectedInvoice.client_name}
          </h2>
        </div>

        <button
          className="primary"
          onClick={() => onRunSweep(selectedInvoice)}
          disabled={isSweeping}
          style={{ minWidth: '180px', height: '44px' }}
        >
          <Play size={16} fill="currentColor" />
          <span>{isSweeping ? 'Running Sweep...' : 'Run Agent Sweep'}</span>
        </button>
      </div>

      {/* Preset Buttons */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {invoices.map((inv) => {
          const isSelected = selectedInvoice.invoice_id === inv.invoice_id;
          return (
            <button
              key={inv.invoice_id}
              onClick={() => onSelectInvoice(inv)}
              type="button"
              className={isSelected ? 'primary' : 'secondary'}
              style={{
                padding: '8px 14px',
                fontSize: '0.8rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <span>{inv.invoice_id}: {inv.client_name}</span>
            </button>
          );
        })}
      </div>

      {/* Invoice Data Metrics Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '10px',
        }}
      >
        <div
          style={{
            background: 'var(--paper-warm)',
            border: 'var(--stroke-subtle)',
            padding: '12px',
            borderRadius: '3px',
          }}
        >
          <span className="label-text">Invoice Amount</span>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 800,
              marginTop: '4px',
            }}
          >
            ₹{selectedInvoice.amount.toLocaleString('en-IN')}
          </div>
        </div>

        <div
          style={{
            background: 'var(--paper-warm)',
            border: 'var(--stroke-subtle)',
            padding: '12px',
            borderRadius: '3px',
          }}
        >
          <span className="label-text">Days Overdue</span>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 800,
              marginTop: '4px',
              color: selectedInvoice.days_overdue > 30 ? 'var(--red)' : 'var(--ink)',
            }}
          >
            {selectedInvoice.days_overdue} days
          </div>
        </div>

        <div
          style={{
            background: 'var(--paper-warm)',
            border: 'var(--stroke-subtle)',
            padding: '12px',
            borderRadius: '3px',
          }}
        >
          <span className="label-text">Ignored Reminders</span>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 800,
              marginTop: '4px',
            }}
          >
            {selectedInvoice.ignored_reminders}
          </div>
        </div>

        <div
          style={{
            background: 'var(--paper-warm)',
            border: 'var(--stroke-subtle)',
            padding: '12px',
            borderRadius: '3px',
          }}
        >
          <span className="label-text">Relationship Score</span>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 800,
              marginTop: '4px',
            }}
          >
            {selectedInvoice.relationship_score}/100
          </div>
        </div>

        <div
          style={{
            background: 'var(--paper-warm)',
            border: 'var(--stroke-subtle)',
            padding: '12px',
            borderRadius: '3px',
          }}
        >
          <span className="label-text">On-Time Pay Rate</span>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.25rem',
              fontWeight: 800,
              marginTop: '4px',
            }}
          >
            {Math.round(selectedInvoice.historical_on_time_rate * 100)}%
          </div>
        </div>
      </div>

      {selectedInvoice.scenario && (
        <div
          style={{
            marginTop: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            color: 'var(--muted)',
          }}
        >
          <Sparkles size={14} color="var(--amber)" />
          <span>Expected Path: {selectedInvoice.scenario}</span>
        </div>
      )}
    </div>
  );
};
