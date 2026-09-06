import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { useAgentStore } from '../store/agentStore';
import { Link } from 'react-router-dom';
import type { Invoice } from '../lib/api';

const stages = [
  { id: 'created', label: 'Created', color: 'var(--paper-warm)' },
  { id: 'due_soon', label: 'Due Soon', color: 'var(--yellow-soft)' },
  { id: 'monitoring', label: 'Monitoring', color: 'var(--blue)' },
  { id: 'reminder_sent', label: 'Reminder Sent', color: 'var(--lavender)' },
  { id: 'negotiation', label: 'Negotiation', color: '#fff7ed' },
  { id: 'awaiting', label: 'Awaiting Payment', color: 'var(--mint)' },
  { id: 'paid', label: 'Paid', color: 'var(--mint)' },
];

const getInvoiceStage = (inv: Invoice): string => {
  if (inv.status === 'paid') return 'paid';
  if (inv.status === 'escalated') return 'negotiation';
  if (inv.escalation_level >= 2) return 'awaiting';
  if (inv.escalation_level === 1) return 'reminder_sent';

  const dueDate = new Date(inv.due_date);
  const today = new Date();
  const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'monitoring';
  if (diffDays <= 3) return 'due_soon';
  return 'created';
};

export const Pipeline: React.FC = () => {
  const invoices = useStore((s) => s.invoices);
  const fetchInvoices = useStore((s) => s.fetchInvoices);
  const markInvoicePaid = useStore((s) => s.markInvoicePaid);
  const highlightedInvoiceId = useAgentStore((s) => s.highlightedInvoiceId);
  const [activeStage, setActiveStage] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const stageCounts = stages.map(s => ({
    ...s,
    count: invoices.filter(inv => getInvoiceStage(inv) === s.id).length
  }));

  const filtered = activeStage
    ? invoices.filter(inv => getInvoiceStage(inv) === activeStage)
    : invoices;

  const activeLabel = stages.find(s => s.id === activeStage)?.label || 'All';

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 className="page-title">Collections</h2>
            <p className="page-subtitle">Invoice recovery lifecycle · {invoices.length} total</p>
          </div>
          <Link to="/add">
            <button className="primary">+ New Invoice</button>
          </Link>
        </div>
      </div>

      {/* Lifecycle Stage Bar */}
      <div style={{
        display: 'flex',
        gap: '2px',
        marginBottom: '28px',
        background: 'var(--border)',
        borderRadius: '4px',
        overflow: 'hidden',
        border: 'var(--stroke-subtle)'
      }}>
        <div
          onClick={() => setActiveStage(null)}
          style={{
            flex: '0 0 auto',
            padding: '10px 16px',
            fontSize: 'var(--text-caption)',
            fontWeight: activeStage === null ? 700 : 500,
            background: activeStage === null ? 'var(--yellow)' : 'var(--white)',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: 'var(--font-sans)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          All
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            opacity: 0.6
          }}>
            {invoices.length}
          </span>
        </div>
        {stageCounts.map(stage => (
          <div
            key={stage.id}
            onClick={() => setActiveStage(stage.id === activeStage ? null : stage.id)}
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: 'var(--text-caption)',
              fontWeight: activeStage === stage.id ? 700 : 500,
              background: activeStage === stage.id ? stage.color : 'var(--white)',
              cursor: 'pointer',
              transition: 'all 0.25s var(--ease-out)',
              textAlign: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontFamily: 'var(--font-sans)',
              borderLeft: '1px solid var(--border)'
            }}
          >
            {stage.label}
            {stage.count > 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-label)',
                background: activeStage === stage.id ? 'rgba(0,0,0,0.08)' : 'var(--paper-warm)',
                padding: '1px 6px',
                borderRadius: '2px'
              }}>
                {stage.count}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Invoice List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filtered.length > 0 ? filtered.map((inv) => {
          const stage = getInvoiceStage(inv);
          const stageInfo = stages.find(s => s.id === stage);
          const dueDate = new Date(inv.due_date);
          const today = new Date();
          const daysOverdue = Math.ceil((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

          return (
            <div key={inv.id}
              data-invoice-id={inv.invoice_id}
              data-client-name={inv.client_name}
              className={`os-card ${highlightedInvoiceId === inv.invoice_id ? 'agent-highlight' : ''}`}
              style={{
                padding: '20px',
                transition: 'all 0.4s ease',
                border: highlightedInvoiceId === inv.invoice_id ? '2px solid var(--yellow)' : 'var(--stroke)',
                boxShadow: highlightedInvoiceId === inv.invoice_id ? '0 0 20px rgba(255,212,0,0.3)' : 'var(--shadow-sm)'
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--text-body)' }}>{inv.client_name}</span>
                    <span className={`badge badge-${inv.status === 'paid' ? 'paid' : inv.status === 'escalated' ? 'escalated' : daysOverdue > 0 ? 'warning' : 'open'}`}>
                      {stageInfo?.label || inv.status}
                    </span>
                  </div>
                  <div style={{
                    display: 'flex',
                    gap: '20px',
                    fontSize: 'var(--text-label)',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--muted)'
                  }}>
                    <span>{inv.invoice_id}</span>
                    <span>₹{inv.amount.toLocaleString('en-IN')}</span>
                    <span>Due: {dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    {daysOverdue > 0 && inv.status !== 'paid' && (
                      <span style={{ color: 'var(--red)' }}>{daysOverdue}d overdue</span>
                    )}
                  </div>

                  {/* AI Decision Transparency */}
                  {inv.status !== 'paid' && (
                    <div style={{
                      marginTop: '10px',
                      padding: '8px 12px',
                      background: 'var(--paper-warm)',
                      borderRadius: '3px',
                      fontSize: 'var(--text-label)',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--muted)',
                      display: 'flex',
                      gap: '16px'
                    }}>
                      <span>AI Confidence: {Math.max(45, 95 - daysOverdue * 3)}%</span>
                      <span>Strategy: {inv.escalation_level === 0 ? 'Gentle reminder' : inv.escalation_level === 1 ? 'Firm nudge' : 'Owner escalation'}</span>
                      <span>Last action: {inv.last_action_at ? new Date(inv.last_action_at).toLocaleDateString() : 'Pending'}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginLeft: '16px' }}>
                  {inv.status !== 'paid' && (
                    <button
                      className="ghost"
                      onClick={() => markInvoicePaid(inv.id, inv.amount)}
                      style={{ padding: '6px 12px', fontSize: 'var(--text-label)' }}
                    >
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        }) : (
          <div style={{
            padding: '48px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 'var(--text-caption)'
          }}>
            {activeStage
              ? `No invoices in the "${activeLabel}" stage.`
              : 'No invoices yet. Create your first to begin autonomous collection.'}
          </div>
        )}
      </div>
    </div>
  );
};

export default Pipeline;
