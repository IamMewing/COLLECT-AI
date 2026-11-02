import React from 'react';
import type { Invoice } from '../types';
import { Check, Plus, Zap } from 'lucide-react';

interface InvoiceSelectorProps {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  onSelectInvoice: (inv: Invoice) => void;
  onRunSweep: (inv: Invoice) => void;
  isSweeping: boolean;
  onAddInvoice?: () => void;
  onMarkPaid?: (inv: Invoice) => void;
  isMarkingPaid?: boolean;
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');
const short = (n: number) => (n >= 1000 ? '₹' + Math.round(n / 1000) + 'k' : '₹' + n);

export const InvoiceSelector: React.FC<InvoiceSelectorProps> = ({
  invoices, selectedInvoice, onSelectInvoice, onRunSweep,
  isSweeping, onAddInvoice, onMarkPaid, isMarkingPaid,
}) => {
  if (!selectedInvoice) return null;
  const inv = selectedInvoice;
  const paid = inv.status === 'paid';
  const late = inv.days_overdue > 30;

  return (
    <div>
      {/* pick an invoice */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 14, flexWrap: 'wrap', marginBottom: 16,
        }}
      >
        <span className="marker">Pick an account</span>
        {onAddInvoice && (
          <button type="button" className="pill pill--sm" onClick={onAddInvoice}>
            <Plus size={13} /> New invoice
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 'clamp(28px, 4vw, 48px)' }}>
        {invoices.map((i) => {
          const on = i.invoice_id === inv.invoice_id;
          return (
            <button
              key={i.invoice_id}
              className={`pill pill--sm${on ? ' pill--solid' : ''}`}
              onClick={() => onSelectInvoice(i)}
              style={i.status === 'paid' && !on ? { opacity: 0.45 } : undefined}
            >
              {i.status === 'paid' && <Check size={12} />}
              {i.client_name} <span style={{ opacity: 0.6 }}>{short(i.amount)}</span>
            </button>
          );
        })}
      </div>

      {/* the selected account */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          gap: 'clamp(20px, 3vw, 44px)', flexWrap: 'wrap', marginBottom: 'clamp(20px, 3vw, 32px)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="mono" style={{ opacity: 0.6 }}>{inv.invoice_id}</span>
            {paid && (
              <span className="tag tag--paid">
                {inv.paid_via === 'paypal' ? 'Paid via PayPal — closed itself' : 'Paid'}
              </span>
            )}
            {!paid && late && <span className="tag tag--risk">{inv.days_overdue} days late</span>}
          </div>
          <h3 className="name" style={{ letterSpacing: '-0.04em' }}>{inv.client_name}</h3>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {onMarkPaid && !paid && (
            <button
              type="button"
              className="pill"
              onClick={() => onMarkPaid(inv)}
              disabled={isMarkingPaid}
              title="Tell the agent the money arrived, so it stops chasing"
            >
              {isMarkingPaid ? <span className="spin" /> : <Check size={15} />}
              Mark paid
            </button>
          )}
          <button
            className="pill pill--lg pill--solid"
            onClick={() => onRunSweep(inv)}
            disabled={isSweeping || paid}
            title={paid ? 'This one is settled — nothing to chase' : undefined}
          >
            {paid ? <><Check size={16} /> Settled</>
              : isSweeping ? <><span className="spin" /> Thinking…</>
              : <><Zap size={16} /> Run the agent</>}
          </button>
        </div>
      </div>

      <dl className="readouts">
        <div className="readout">
          <dt>Amount due</dt>
          <dd>{inr(inv.amount)}</dd>
        </div>
        <div className="readout">
          <dt>Days late</dt>
          <dd style={late ? { color: 'var(--warn)' } : undefined}>
            {inv.days_overdue}<small>d</small>
          </dd>
        </div>
        <div className="readout">
          <dt>Reminders ignored</dt>
          <dd style={inv.ignored_reminders >= 2 ? { color: 'var(--warn)' } : undefined}>
            {inv.ignored_reminders}
          </dd>
        </div>
        <div className="readout">
          <dt>Client standing</dt>
          <dd>{inv.relationship_score}<small>/100</small></dd>
        </div>
        <div className="readout">
          <dt>Pays on time</dt>
          <dd>{Math.round(inv.historical_on_time_rate * 100)}<small>%</small></dd>
        </div>
      </dl>
    </div>
  );
};

export default InvoiceSelector;
