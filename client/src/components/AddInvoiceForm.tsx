import React, { useState } from 'react';
import type { Invoice } from '../types';
import { createInvoice } from '../api';
import { X, FilePlus2, Loader2 } from 'lucide-react';

interface AddInvoiceFormProps {
  onClose: () => void;
  onCreated: (invoice: Invoice) => void;
}

const field: React.CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 8,
  background: 'var(--surface-inset)', border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontSize: '0.88rem',
  outline: 'none',
};
const label: React.CSSProperties = {
  display: 'block', marginBottom: 7,
};

export const AddInvoiceForm: React.FC<AddInvoiceFormProps> = ({ onClose, onCreated }) => {
  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [daysOverdue, setDaysOverdue] = useState('0');
  const [ignoredReminders, setIgnoredReminders] = useState('0');
  const [relationshipScore, setRelationshipScore] = useState('75');
  const [onTimeRate, setOnTimeRate] = useState('80');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !amount || Number(amount) <= 0) {
      setFormError('Client name and a positive amount are required.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const invoice = await createInvoice({
        client_name: clientName.trim(),
        amount: Number(amount),
        days_overdue: Number(daysOverdue) || 0,
        ignored_reminders: Number(ignoredReminders) || 0,
        relationship_score: Math.min(100, Math.max(0, Number(relationshipScore) || 75)),
        historical_on_time_rate: Math.min(100, Math.max(0, Number(onTimeRate) || 80)) / 100,
      });
      onCreated(invoice);
    } catch (err: any) {
      setFormError(err?.details || err?.error || 'Could not create invoice. Is the server running?');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(4,6,11,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="ledger-panel ledger-panel-glow-gold"
        style={{ width: '100%', maxWidth: 520, padding: '26px 28px', maxHeight: '88vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FilePlus2 size={18} color="var(--gold)" />
            <h3 className="display-title" style={{ fontSize: '1.15rem' }}>Add Invoice to Ledger</h3>
          </div>
          <button type="button" className="btn btn-neutral" onClick={onClose} style={{ padding: '7px 10px' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <span className="mono-label" style={label}>Client / Business Name *</span>
            <input style={field} value={clientName} onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Horizon Retail Pvt. Ltd." autoFocus />
          </div>

          <div>
            <span className="mono-label" style={label}>Invoice Amount (INR) *</span>
            <input style={field} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="185000" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <span className="mono-label" style={label}>Days Overdue</span>
              <input style={field} type="number" min={0} value={daysOverdue} onChange={(e) => setDaysOverdue(e.target.value)} />
            </div>
            <div>
              <span className="mono-label" style={label}>Ignored Reminders</span>
              <input style={field} type="number" min={0} value={ignoredReminders} onChange={(e) => setIgnoredReminders(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <span className="mono-label" style={label}>Relationship Score (0-100)</span>
              <input style={field} type="number" min={0} max={100} value={relationshipScore} onChange={(e) => setRelationshipScore(e.target.value)} />
            </div>
            <div>
              <span className="mono-label" style={label}>On-Time Rate (%)</span>
              <input style={field} type="number" min={0} max={100} value={onTimeRate} onChange={(e) => setOnTimeRate(e.target.value)} />
            </div>
          </div>

          {formError && (
            <div style={{ color: 'var(--critical)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>{formError}</div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ marginTop: 6, height: 46 }}>
            {submitting ? <Loader2 size={16} className="spinner" style={{ border: 'none' }} /> : <FilePlus2 size={16} />}
            <span>{submitting ? 'Adding to Ledger…' : 'Add Invoice & Select'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddInvoiceForm;
