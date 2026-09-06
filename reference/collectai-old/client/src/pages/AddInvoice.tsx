import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { CustomSelect } from '../components/CustomSelect';

export const AddInvoice: React.FC = () => {
  const navigate = useNavigate();
  const businesses = useStore((state) => state.businesses);
  const createInvoice = useStore((state) => state.createInvoice);
  const selectedBusinessId = useStore((state) => state.selectedBusinessId);
  const addToast = useStore((state) => state.addToast);

  const [businessId, setBusinessId] = useState(selectedBusinessId || '');
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
      addToast('Please select a workspace profile', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      await createInvoice({
        business_id: businessId,
        client_name: clientName,
        client_email: clientEmail || undefined,
        amount: parseFloat(amount),
        due_date: dueDate,
        description: description || undefined
      });
      navigate('/collections');
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      <div className="page-header">
        <h2 className="page-title">New Invoice</h2>
        <p className="page-subtitle">Delegate accounts receivable recovery to your AI employee</p>
      </div>

      <div className="os-card">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>

          <div>
            <CustomSelect
              label="Select Workspace Profile *"
              value={businessId}
              onChange={setBusinessId}
              placeholder="Select profile..."
              options={businesses.map(b => ({
                value: b.business_id,
                label: b.name,
                description: `Workspace: ${b.owner_email}`
              }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label className="label-text">Client Company Name *</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Apex Labs"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label-text">Client Billing Email *</label>
              <input
                type="email"
                className="input-field"
                placeholder="billing@apex.com"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label className="label-text">Invoice Amount (₹) *</label>
              <input
                type="number"
                className="input-field"
                placeholder="45000"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label-text">Payment Due Date *</label>
              <input
                type="date"
                className="input-field"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label className="label-text">Description / Scope</label>
            <textarea
              className="input-field"
              style={{ minHeight: '90px', resize: 'vertical' }}
              placeholder="e.g. Design sprint retainer — Milestone 2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button type="submit" className="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Creating Invoice...' : 'Create Invoice'}
            </button>
            <button type="button" className="ghost" onClick={() => navigate('/collections')}>
              Cancel
            </button>
          </div>

        </form>
      </div>
    </div>
  );
};

export default AddInvoice;
