import React, { useState } from 'react';
import type { Invoice } from '../types';
import { createInvoice } from '../api';
import { X } from 'lucide-react';

interface AddInvoiceFormProps {
  onClose: () => void;
  onCreated: (invoice: Invoice) => void;
}

export const AddInvoiceForm: React.FC<AddInvoiceFormProps> = ({ onClose, onCreated }) => {
  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState('');
  const [daysOverdue, setDaysOverdue] = useState('0');
  const [ignoredReminders, setIgnoredReminders] = useState('0');
  const [standing, setStanding] = useState('75');
  const [onTimeRate, setOnTimeRate] = useState('80');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !amount || Number(amount) <= 0) {
      setFormError('Add a client name and an amount above zero.');
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
        relationship_score: Math.min(100, Math.max(0, Number(standing) || 75)),
        historical_on_time_rate: Math.min(100, Math.max(0, Number(onTimeRate) || 80)) / 100,
      });
      onCreated(invoice);
    } catch (err: any) {
      setFormError(err?.details || err?.error || 'Could not save that. Check the server is running.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add an invoice">
      <form className="overlay-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 }}>
          <h3 className="title">Add an invoice</h3>
          <button type="button" className="pill pill--icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label className="lbl" htmlFor="af-client">Who owes you</label>
            <input
              id="af-client" className="inp" value={clientName} autoFocus
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Horizon Retail Pvt. Ltd."
            />
          </div>

          <div>
            <label className="lbl" htmlFor="af-amount">How much (₹)</label>
            <input
              id="af-amount" className="inp" type="number" min={1} value={amount}
              onChange={(e) => setAmount(e.target.value)} placeholder="185000"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label className="lbl" htmlFor="af-days">Days late</label>
              <input id="af-days" className="inp" type="number" min={0} value={daysOverdue}
                onChange={(e) => setDaysOverdue(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="af-ignored">Reminders ignored</label>
              <input id="af-ignored" className="inp" type="number" min={0} value={ignoredReminders}
                onChange={(e) => setIgnoredReminders(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label className="lbl" htmlFor="af-standing">Client standing (0–100)</label>
              <input id="af-standing" className="inp" type="number" min={0} max={100} value={standing}
                onChange={(e) => setStanding(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="af-ontime">Pays on time (%)</label>
              <input id="af-ontime" className="inp" type="number" min={0} max={100} value={onTimeRate}
                onChange={(e) => setOnTimeRate(e.target.value)} />
            </div>
          </div>

          {formError && (
            <p className="mono" style={{ color: 'var(--blood)', fontSize: '0.8rem' }}>{formError}</p>
          )}

          <button type="submit" className="pill pill--lg pill--solid" disabled={submitting} style={{ marginTop: 4 }}>
            {submitting ? <><span className="spin" /> Saving…</> : 'Add it to the ledger'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddInvoiceForm;
