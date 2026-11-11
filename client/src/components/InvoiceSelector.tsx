import React from 'react';
import type { Invoice } from '../types';
import { Check, Phone, Plus, Zap } from 'lucide-react';
import { ImportCsvButton } from './ImportCsvButton';

/**
 * The actions for whichever account is selected in the grid above.
 *
 * This used to also carry a row of pills listing every invoice, and a
 * readout strip of the selected one's figures. Both were deleted: the pills
 * restated the grid's rows, and every one of the five readouts (amount, days
 * late, reminders ignored, standing, on-time rate) was already a column in
 * that same grid, two hundred pixels higher. Three representations of two
 * records reads as generous at two accounts and as padding at forty — so
 * selection lives in the grid alone, and this is just what you can DO with
 * what's selected.
 */
interface InvoiceSelectorProps {
  selectedInvoice: Invoice | null;
  onRunSweep: (inv: Invoice) => void;
  isSweeping: boolean;
  onAddInvoice?: () => void;
  onMarkPaid?: (inv: Invoice) => void;
  isMarkingPaid?: boolean;
  /** Places a real outbound AI voice call (Phase 5). Omitted entirely hides
   *  the button; shown only when the selected invoice has a phone on file. */
  onCallThem?: (inv: Invoice) => void;
  isCalling?: boolean;
  /** Called after a CSV import saves at least one row, so the parent can
   *  refetch the ledger. Omitted entirely hides the Import CSV button. */
  onInvoicesImported?: () => void;
}


export const InvoiceSelector: React.FC<InvoiceSelectorProps> = ({
  selectedInvoice, onRunSweep,
  isSweeping, onAddInvoice, onMarkPaid, isMarkingPaid, onCallThem, isCalling, onInvoicesImported,
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
        <span className="marker">Selected account</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onInvoicesImported && <ImportCsvButton onImported={onInvoicesImported} />}
          {onAddInvoice && (
            <button type="button" className="pill pill--sm" onClick={onAddInvoice}>
              <Plus size={13} /> New invoice
            </button>
          )}
        </div>
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
          {onCallThem && !!inv.phone && !paid && (
            <button
              type="button"
              className="pill"
              onClick={() => onCallThem(inv)}
              disabled={isCalling}
              title="Places a real outbound call — the agent introduces itself and negotiates live"
            >
              {isCalling ? <span className="spin" /> : <Phone size={15} />}
              Call them
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

    </div>
  );
};

export default InvoiceSelector;
