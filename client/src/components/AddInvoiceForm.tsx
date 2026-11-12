import React, { useState } from 'react';
import type { Invoice } from '../types';
import { createInvoice, updateInvoice } from '../api';
import { X } from 'lucide-react';

interface AddInvoiceFormProps {
  onClose: () => void;
  onCreated: (invoice: Invoice) => void;
  /** When set, the form edits this invoice in place (PATCH) instead of
   *  creating a new one — same fields, prefilled from its current values. */
  invoice?: Invoice;
}

export const AddInvoiceForm: React.FC<AddInvoiceFormProps> = ({ onClose, onCreated, invoice }) => {
  const isEditing = !!invoice;
  const [clientName, setClientName] = useState(invoice?.client_name ?? '');
  const [email, setEmail] = useState(invoice?.email ?? '');
  const [phone, setPhone] = useState(invoice?.phone ?? '');
  const [amount, setAmount] = useState(invoice ? String(invoice.amount) : '');
  const [daysOverdue, setDaysOverdue] = useState(invoice ? String(invoice.days_overdue) : '0');
  const [ignoredReminders, setIgnoredReminders] = useState(invoice ? String(invoice.ignored_reminders) : '0');
  const [standing, setStanding] = useState(invoice ? String(invoice.relationship_score) : '75');
  const [onTimeRate, setOnTimeRate] = useState(
    invoice ? String(Math.round(invoice.historical_on_time_rate * 100)) : '80'
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim() || !amount || Number(amount) <= 0) {
      setFormError('Add a client name and an amount above zero.');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError("That email doesn't look right — double-check it or leave it blank.");
      return;
    }
    if (phone.trim() && !/^\+?[0-9\s().-]{7,20}$/.test(phone.trim())) {
      setFormError("That phone number doesn't look right — use E.164 (e.g. +14155550100) or leave it blank.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const shared = {
        client_name: clientName.trim(),
        amount: Number(amount),
        days_overdue: Number(daysOverdue) || 0,
        ignored_reminders: Number(ignoredReminders) || 0,
        relationship_score: Math.min(100, Math.max(0, Number(standing) || 75)),
        historical_on_time_rate: Math.min(100, Math.max(0, Number(onTimeRate) || 80)) / 100,
      };
      const saved = isEditing
        // Editing sends email/phone even when blank — that's how you clear
        // one (e.g. to switch an invoice from WhatsApp back to email).
        ? await updateInvoice(invoice!.invoice_id, { ...shared, email: email.trim(), phone: phone.trim() })
        : await createInvoice({
            ...shared,
            ...(email.trim() ? { email: email.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          });
      onCreated(saved);
    } catch (err: any) {
      setFormError(err?.details || err?.error || 'Could not save that. Check the server is running.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={isEditing ? 'Edit invoice' : 'Add an invoice'}>
      <form className="overlay-card" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 26 }}>
          <h3 className="title">{isEditing ? `Edit ${invoice!.invoice_id}` : 'Add an invoice'}</h3>
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
            <label className="lbl" htmlFor="af-email">Their email (optional)</label>
            <input
              id="af-email" className="inp" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ap@client-company.com"
            />
            <p className="mono" style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: 4 }}>
              If you leave this blank, outreach for this invoice goes to the demo inbox instead of the real client.
            </p>
          </div>

          <div>
            <label className="lbl" htmlFor="af-phone">Their phone (optional)</label>
            <input
              id="af-phone" className="inp" type="tel" value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+14155550100"
            />
            <p className="mono" style={{ color: 'var(--muted)', fontSize: '0.72rem', marginTop: 4 }}>
              Add this to let the agent reach them by WhatsApp or SMS, not just email — use the full international format (e.g. +1…).
            </p>
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
            <p className="mono" style={{ color: 'var(--warn)', fontSize: '0.8rem' }}>{formError}</p>
          )}

          <button type="submit" className="pill pill--lg pill--solid" disabled={submitting} style={{ marginTop: 4 }}>
            {submitting ? <><span className="spin" /> Saving…</> : isEditing ? 'Save changes' : 'Add it to the ledger'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AddInvoiceForm;
