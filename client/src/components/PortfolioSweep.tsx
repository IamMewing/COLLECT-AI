import React, { useState } from 'react';
import type { Invoice, PortfolioSweepResult, PortfolioOutcome } from '../types';
import { sweepPortfolio } from '../api';
import { Zap, ChevronDown, AlertTriangle } from 'lucide-react';

interface PortfolioSweepProps {
  invoices: Invoice[];
  onSelectInvoice: (inv: Invoice) => void;
}

const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

const branchLabel = (o: PortfolioOutcome): { text: string; tone: 'escalate' | 'standard' | 'none' } => {
  if (!o.ok) return { text: 'Failed', tone: 'escalate' };
  const branch = o.plan?.branch;
  if (branch === 'escalation') return { text: `Escalate · ${o.plan.channel}`, tone: 'escalate' };
  if (branch === 'no_action') return { text: 'Left alone', tone: 'none' };
  return { text: `Chase · ${o.plan?.channel ?? 'email'}`, tone: 'standard' };
};

/**
 * Running the agent on one invoice at a time proves it reasons. Running it
 * across every open account at once proves it scales — the difference
 * between a demo and an ops tool. This reuses the same /api/agent/sweep
 * machinery (and the same real-vs-mock graph) across the whole ledger in one
 * click, bounded server-side so it can't fire a burst large enough to trip
 * the same rate limits the single-invoice path already retries around.
 */
export const PortfolioSweep: React.FC<PortfolioSweepProps> = ({ invoices, onSelectInvoice }) => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PortfolioSweepResult | null>(null);
  const [failedToStart, setFailedToStart] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);

  const openCount = invoices.filter((i) => i.status !== 'paid').length;
  const byId = new Map(invoices.map((i) => [i.invoice_id, i]));

  const run = async () => {
    setRunning(true);
    setFailedToStart(null);
    try {
      const res = await sweepPortfolio();
      setResult(res);
    } catch (err: any) {
      setFailedToStart(err?.error || err?.message || 'The portfolio sweep didn’t finish.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="pswp">
      <div className="pswp-head">
        <div>
          <h3 className="title" style={{ marginBottom: 6 }}>Sweep the whole portfolio</h3>
          <p className="body body--sm" style={{ opacity: 0.75, maxWidth: '48ch' }}>
            Runs the agent on all {openCount} open account{openCount === 1 ? '' : 's'} at once — who it would
            chase, who it would escalate, who it would leave alone, and why.
          </p>
        </div>
        <button type="button" className="pill pill--lg pill--solid" onClick={run} disabled={running || openCount === 0}>
          {running ? <span className="spin" /> : <Zap size={16} />}
          {running ? 'Sweeping…' : 'Sweep all'}
        </button>
      </div>

      {failedToStart && (
        <p className="body body--sm" style={{ color: 'var(--warn)', marginTop: 14 }}>{failedToStart}</p>
      )}

      {result && (
        <>
          <dl className="readouts pswp-summary">
            <div className="readout">
              <dt>Swept</dt>
              <dd>{result.summary.total}</dd>
            </div>
            <div className="readout">
              <dt>Escalating</dt>
              {/* State on a light field is a fill, never a text hue — the same
                  rule the "days late" grid cell already follows — so a count
                  worth noticing gets the coral chip, not coloured digits that
                  would just render as the same black as everything else. */}
              {result.summary.escalation > 0 ? (
                <dd><span className="tag tag--risk" style={{ fontSize: '0.85em' }}>{result.summary.escalation}</span></dd>
              ) : (
                <dd>{result.summary.escalation}</dd>
              )}
            </div>
            <div className="readout">
              <dt>Standard chase</dt>
              <dd>{result.summary.standard}</dd>
            </div>
            <div className="readout">
              <dt>Left alone</dt>
              <dd>{result.summary.no_action}</dd>
            </div>
            {result.summary.failed > 0 && (
              <div className="readout">
                <dt>Failed</dt>
                <dd><span className="tag tag--risk" style={{ fontSize: '0.85em' }}>{result.summary.failed}</span></dd>
              </div>
            )}
          </dl>

          <ul className="pswp-list">
            {result.results.map((o) => {
              const { text, tone } = branchLabel(o);
              const open = openRow === o.invoice_id;
              const hasReason = o.ok && (o.plan?.reasoning || o.risk?.reasoning);
              const toggle = () => hasReason && setOpenRow(open ? null : o.invoice_id);
              return (
                <li key={o.invoice_id} className="pswp-row">
                  {/* A div, not a button — it has a real button (Open) living
                      inside it, and interactive-inside-interactive is exactly
                      the kind of thing that reads fine until a screen reader
                      or a stray click handler proves otherwise. */}
                  <div
                    className="pswp-row-main"
                    role={hasReason ? 'button' : undefined}
                    tabIndex={hasReason ? 0 : undefined}
                    onClick={toggle}
                    onKeyDown={(e) => { if (hasReason && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
                    aria-expanded={hasReason ? open : undefined}
                  >
                    <span className="pswp-id mono">{o.invoice_id}</span>
                    <span className="pswp-client">{o.client_name}</span>
                    {o.ok && (
                      <span className="pswp-amount mono">{inr(o.invoice.amount)}</span>
                    )}
                    <span className={`tag${tone === 'escalate' ? ' tag--risk' : ''}`} style={tone === 'none' ? { opacity: 0.55 } : undefined}>
                      {!o.ok && <AlertTriangle size={12} style={{ marginRight: 4 }} />}
                      {text}
                    </span>
                    {o.ok && (
                      <span className="mono pswp-odds" style={{ opacity: 0.65 }}>
                        {o.risk.category} · {o.probability.probability}% likely to pay
                      </span>
                    )}
                    {byId.has(o.invoice_id) && (
                      <button
                        type="button"
                        className="pill pill--sm"
                        onClick={(e) => { e.stopPropagation(); onSelectInvoice(byId.get(o.invoice_id)!); }}
                      >
                        Open
                      </button>
                    )}
                    {hasReason && (
                      <ChevronDown size={14} className={`pswp-chev${open ? ' is-open' : ''}`} />
                    )}
                  </div>
                  {open && o.ok && (
                    <div className="pswp-reason">
                      <p><strong>Plan — </strong>{o.plan.reasoning}</p>
                      <p><strong>Risk — </strong>{o.risk.reasoning}</p>
                    </div>
                  )}
                  {open && !o.ok && (
                    <div className="pswp-reason">
                      <p style={{ fontStyle: 'italic' }}>{o.details || o.error}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

export default PortfolioSweep;
