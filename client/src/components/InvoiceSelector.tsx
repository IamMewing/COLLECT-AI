import React, { useRef } from 'react';
import type { Invoice } from '../types';
import { Zap, TrendingUp } from 'lucide-react';

interface InvoiceSelectorProps {
  invoices: Invoice[];
  selectedInvoice: Invoice | null;
  onSelectInvoice: (inv: Invoice) => void;
  onRunSweep: (inv: Invoice) => void;
  isSweeping: boolean;
  onAddInvoice?: () => void;
}

const fmtINR = (n: number) => '₹' + n.toLocaleString('en-IN');
const fmtShort = (n: number) => (n >= 1000 ? '₹' + Math.round(n / 1000) + 'k' : '₹' + n);

/** Pointer-tracking helper: writes --mx/--my onto the element for spotlight/glare. */
function useSpotlight() {
  return (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
}

const MetricTile: React.FC<{
  label: string; value: React.ReactNode; sub: string; color?: string;
}> = ({ label, value, sub, color }) => {
  const onMove = useSpotlight();
  const ref = useRef<HTMLDivElement>(null);

  const handleTilt = (e: React.PointerEvent<HTMLDivElement>) => {
    onMove(e);
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateY(${px * 6}deg) rotateX(${-py * 6}deg) translateZ(4px)`;
  };
  const reset = () => { if (ref.current) ref.current.style.transform = ''; };

  return (
    <div ref={ref} className="metric-tile" onPointerMove={handleTilt} onPointerLeave={reset}>
      <div className="metric-glare" />
      <div className="metric-label">{label}</div>
      <div className="metric-value mono-value" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  );
};

export const InvoiceSelector: React.FC<InvoiceSelectorProps> = ({
  invoices, selectedInvoice, onSelectInvoice, onRunSweep, isSweeping, onAddInvoice,
}) => {
  const onSpot = useSpotlight();
  if (!selectedInvoice) return null;

  const inv = selectedInvoice;
  const overdueColor =
    inv.days_overdue > 30 ? 'var(--critical)' : inv.days_overdue > 10 ? 'var(--warning)' : 'var(--text-primary)';
  const remColor = inv.ignored_reminders >= 2 ? 'var(--critical)' : inv.ignored_reminders >= 1 ? 'var(--warning)' : 'var(--text-primary)';

  return (
    <section className="ledger-panel card-spotlight reveal d2" onPointerMove={onSpot} style={{ padding: '26px 28px' }}>
      {/* header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="mono-label" style={{ marginBottom: 6 }}>Active Ledger Entry Under Surveillance</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h2 className="display-title" style={{ fontSize: '1.7rem' }}>{inv.client_name}</h2>
            <span className="badge badge-neutral">{inv.invoice_id}</span>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => onRunSweep(inv)}
          disabled={isSweeping}
          style={{ minWidth: 210 }}
        >
          {isSweeping ? <><span className="spinner" style={{ borderTopColor: '#1A1300' }} /> Reasoning Sweep…</>
                      : <><Zap size={16} /> Run Autonomous Sweep</>}
        </button>
      </div>

      {/* metric grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 22 }}>
        <MetricTile label="Receivable Amount" value={fmtINR(inv.amount)} sub="Principal ledger value" color="var(--gold)" />
        <MetricTile label="Days Past Due" value={<>{inv.days_overdue}<span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 6 }}>days</span></>} sub="Aging threshold" color={overdueColor} />
        <MetricTile label="Ignored Reminders" value={<>{inv.ignored_reminders}<span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 6 }}>notices</span></>} sub="Prior outreach" color={remColor} />
        <MetricTile label="Relationship Capital" value={<>{inv.relationship_score}<span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>/100</span></>} sub="Account goodwill" />
        <MetricTile label="On-Time Rate" value={`${Math.round(inv.historical_on_time_rate * 100)}%`} sub="Payment reliability" color={inv.historical_on_time_rate >= 0.8 ? 'var(--healthy)' : 'var(--text-primary)'} />
      </div>

      {/* selector tape */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="mono-label">Select Verification Account</div>
          {onAddInvoice && (
            <button type="button" className="btn btn-neutral" onClick={onAddInvoice} style={{ padding: '7px 14px', fontSize: '0.78rem' }}>
              + New Invoice
            </button>
          )}
        </div>
        <div className="invoice-tape">
          {invoices.map((i) => (
            <button
              key={i.invoice_id}
              className={`invoice-chip ${i.invoice_id === inv.invoice_id ? 'active' : ''}`}
              onClick={() => onSelectInvoice(i)}
            >
              {i.invoice_id === inv.invoice_id && <span className="pulse-dot" style={{ width: 6, height: 6, color: 'var(--gold)' }} />}
              {i.invoice_id} · {i.client_name} · <span className="chip-amt">{fmtShort(i.amount)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* expected-path ribbon */}
      {inv.scenario && (
        <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
          borderRadius: 10, background: 'rgba(255,210,63,0.05)', border: '1px solid rgba(255,210,63,0.18)' }}>
          <TrendingUp size={15} color="var(--gold)" />
          <span className="mono-label" style={{ color: 'var(--text-secondary)' }}>Expected Agent Behavior:</span>
          <strong style={{ color: 'var(--gold)', fontFamily: 'var(--font-display)', fontSize: '0.9rem' }}>{inv.scenario}</strong>
        </div>
      )}
    </section>
  );
};

export default InvoiceSelector;
