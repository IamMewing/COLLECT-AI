import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { WorkflowVisualizer } from '../components/WorkflowVisualizer';
import type { Invoice } from '../lib/api';

export const Invoices: React.FC = () => {
  const invoices = useStore((state) => state.invoices);
  const fetchInvoices = useStore((state) => state.fetchInvoices);
  const markInvoicePaid = useStore((state) => state.markInvoicePaid);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined);
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices(activeFilter);
  }, [activeFilter]);

  const handleFilterChange = (filter: string | undefined) => {
    setActiveFilter(filter);
  };

  const toggleExpand = (id: string) => {
    setExpandedInvoiceId(expandedInvoiceId === id ? null : id);
  };

  const getStampClass = (inv: Invoice) => {
    if (inv.status === 'paid') return 'stamp-paid';
    if (inv.status === 'escalated') return 'stamp-escalated';
    if (inv.escalation_level === 2) return 'stamp-nudge';
    if (inv.escalation_level === 1) return 'stamp-reminder';
    return 'stamp-open';
  };

  const getStampText = (inv: Invoice) => {
    if (inv.status === 'paid') return 'STAMP: PAID — CLOSED';
    if (inv.status === 'escalated') return 'STAMP: ESCALATED';
    if (inv.escalation_level === 2) return 'STAMP: FIRM NUDGE';
    if (inv.escalation_level === 1) return 'STAMP: GENTLE REMINDER';
    return 'STAMP: OPEN CYCLE';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '2.5rem', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
          📄 INVOICES & RECEIVABLES
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', marginTop: '4px' }}>
          TRACK CLIENT DELIVERABLES AND PIPELINE STAGES
        </p>
      </div>

      {/* Filter tab buttons */}
      <div 
        style={{ 
          display: 'flex', 
          gap: '12px', 
          marginBottom: '32px',
          borderBottom: 'var(--stroke)',
          paddingBottom: '16px'
        }}
      >
        <button 
          className={activeFilter === undefined ? 'primary btn-sm' : 'btn-sm'} 
          onClick={() => handleFilterChange(undefined)}
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          All
        </button>
        <button 
          className={activeFilter === 'open' ? 'primary btn-sm' : 'btn-sm'} 
          onClick={() => handleFilterChange('open')}
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          Pending
        </button>
        <button 
          className={activeFilter === 'paid' ? 'primary btn-sm' : 'btn-sm'} 
          onClick={() => handleFilterChange('paid')}
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          Paid
        </button>
        <button 
          className={activeFilter === 'escalated' ? 'primary btn-sm' : 'btn-sm'} 
          onClick={() => handleFilterChange('escalated')}
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          Escalated
        </button>
      </div>

      {/* Mission Cards Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {invoices.length === 0 ? (
          <div className="os-card text-center" style={{ padding: '60px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800, marginBottom: '8px' }}>
              NO CLIENT INVOICES FOUND
            </h3>
            <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
              Select a different filter or register a new contract.
            </p>
          </div>
        ) : (
          invoices.map((inv) => {
            const isExpanded = expandedInvoiceId === inv.id;
            const dueDate = new Date(inv.due_date);
            const daysOverdue = Math.max(0, Math.floor((new Date().getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));

            return (
              <div 
                key={inv.id}
                className="os-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  borderWidth: '3px',
                  borderColor: 'var(--ink)'
                }}
              >
                {/* Visual upper band */}
                <div 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '16px'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', fontWeight: 700, color: 'var(--muted)' }}>
                      MISSION: {inv.invoice_id}
                    </span>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800 }}>
                      {inv.client_name}
                    </h3>
                    <p style={{ fontSize: '0.88rem', color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
                      {inv.description || 'Deliverable contract scope'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'right' }}>
                      <span className="label-text">AMOUNT DUE</span>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 800 }}>
                        ₹{inv.amount.toLocaleString('en-IN')}
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span className="label-text">DUE BY</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 700 }}>
                        {dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {daysOverdue > 0 && inv.status !== 'paid' && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--red)', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                          {daysOverdue}D OVERDUE
                        </div>
                      )}
                    </div>

                    <span className={`stamp-overlay ${getStampClass(inv)}`}>
                      {getStampText(inv)}
                    </span>
                  </div>
                </div>

                <div 
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    borderTop: '1px solid var(--border)',
                    paddingTop: '16px'
                  }}
                >
                  <button 
                    className="btn btn-ghost btn-sm"
                    onClick={() => toggleExpand(inv.id)}
                    style={{ padding: '6px 12px', fontSize: '0.78rem' }}
                  >
                    {isExpanded ? '▲ COLLAPSE PIPELINE' : '▼ VIEW AI WORKFLOW'}
                  </button>

                  {inv.status !== 'paid' && (
                    <button 
                      className="primary btn-sm"
                      onClick={() => markInvoicePaid(inv.id, inv.amount)}
                      style={{ padding: '6px 14px', fontSize: '0.78rem' }}
                    >
                      ✓ MARK COLLECTED
                    </button>
                  )}
                </div>

                {isExpanded && <WorkflowVisualizer invoice={inv} />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
