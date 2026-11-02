import React, { useEffect, useState, useCallback } from 'react';
import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError } from './types';
import { fetchInvoices, runSweep, approveAndExecute, markInvoicePaid, checkPaypalStatus } from './api';
import { Boot } from './components/Boot';
import { LiquidBlobs } from './components/LiquidBlobs';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Torn } from './components/Torn';
import { PipelineFlow } from './components/PipelineFlow';
import { InvoiceGrid } from './components/InvoiceGrid';
import { InvoiceSelector } from './components/InvoiceSelector';
import { ApprovalGate } from './components/ApprovalGate';
import { AddInvoiceForm } from './components/AddInvoiceForm';
import { useInView } from './useInView';
import { X } from 'lucide-react';

type Tone = 'acid' | 'ink' | 'bone';

/** A full-bleed colour field that reveals its contents once, on first sight. */
const Field: React.FC<{
  id: string;
  tone: Tone;
  marker: string;
  statement: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, tone, marker, statement, aside, children }) => {
  const [ref, inView] = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      id={id}
      data-field={tone}
      className={`field field--${tone}${inView ? ' is-in' : ''}`}
    >
      <div className="wrap">
        <header
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            gap: 'clamp(18px, 3vw, 40px)', flexWrap: 'wrap',
            marginBottom: 'clamp(32px, 5vw, 64px)',
          }}
        >
          <div>
            <span className="marker fade" style={{ marginBottom: 18, display: 'inline-flex' }}>{marker}</span>
            <h2 className="statement rise rise--1"><span>{statement}</span></h2>
          </div>
          {aside && <div className="fade">{aside}</div>}
        </header>
        <div className="fade">{children}</div>
      </div>
    </section>
  );
};

export const App: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [isSweeping, setIsSweeping] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [paypalConfigured, setPaypalConfigured] = useState(false);

  useEffect(() => {
    checkPaypalStatus()
      .then((s) => setPaypalConfigured(s.configured))
      .catch(() => setPaypalConfigured(false));
  }, []);

  const loadInvoices = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchInvoices();
      setInvoices(data);
      setSelectedInvoice((cur) => cur ?? (data.length ? data[0] : null));
    } catch (err: any) {
      console.error('Failed to fetch invoices:', err);
      setError({
        error: err.error || 'Can’t reach the server',
        details: err.details || 'The API didn’t respond. Check the server is running on port 3001.',
        stderr: err.stderr || null,
      });
    }
  }, []);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const handleSelectInvoice = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setSweepResult(null);
    setApproveResult(null);
    setError(null);
  };

  const handleRunSweep = async (inv: Invoice) => {
    try {
      setIsSweeping(true);
      setError(null);
      setApproveResult(null);
      const result = await runSweep(inv);
      setSweepResult(result);
      document.getElementById('decision')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err: any) {
      console.error('Sweep execution failed:', err);
      setError({
        error: err.error || 'The agent didn’t finish',
        details: err.details || err.message || 'The model may have hit a rate limit. Nothing was lost — try again.',
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsSweeping(false);
    }
  };

  const handleApprove = async (draft: DraftedMessage, editedBody?: string) => {
    try {
      setIsApproving(true);
      setError(null);
      const outcome = await approveAndExecute({
        draft, approved: true, edited_body: editedBody,
        client_name: selectedInvoice?.client_name,
        invoice: selectedInvoice || undefined,
      });
      setApproveResult(outcome);
      await loadInvoices();
    } catch (err: any) {
      console.error('Approval failed:', err);
      setError({
        error: err.error || 'Couldn’t send that',
        details: err.details || err.message,
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async (draft: DraftedMessage) => {
    try {
      setIsApproving(true);
      setError(null);
      const outcome = await approveAndExecute({
        draft, approved: false,
        client_name: selectedInvoice?.client_name,
        invoice: selectedInvoice || undefined,
      });
      setApproveResult(outcome);
    } catch (err: any) {
      console.error('Rejection failed:', err);
      setError({
        error: err.error || 'Couldn’t record that',
        details: err.details || err.message,
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handleReset = () => {
    setSweepResult(null);
    setApproveResult(null);
    setError(null);
  };

  const handleInvoiceCreated = async (invoice: Invoice) => {
    setShowAddInvoice(false);
    await loadInvoices();
    handleSelectInvoice(invoice);
  };

  const handleMarkPaid = async (invoice: Invoice) => {
    setIsMarkingPaid(true);
    try {
      await markInvoicePaid(invoice.invoice_id);
      setSelectedInvoice({ ...invoice, status: 'paid', paid_via: 'manual' });
      await loadInvoices();
    } catch (err) {
      console.error('Failed to mark invoice paid:', err);
    } finally {
      setIsMarkingPaid(false);
    }
  };

  return (
    <>
      <Boot />
      <LiquidBlobs />
      <Nav />

      <main>
        <Hero />

        <Torn from="acid" to="ink" variant={0} />
        <Field
          id="agent"
          tone="ink"
          marker="How it thinks"
          statement="It weighs the money and the odds before it writes a word"
        >
          <PipelineFlow
            sweepResult={sweepResult}
            approveResult={approveResult}
            isSweeping={isSweeping}
            isApproving={isApproving}
            error={error}
            onRetry={selectedInvoice ? () => handleRunSweep(selectedInvoice) : undefined}
          />
        </Field>

        <Torn from="ink" to="acid" variant={1} />
        <Field
          id="ledger"
          tone="acid"
          marker="The ledger"
          statement="Every account it’s watching"
          aside={
            <span className={`tag${paypalConfigured ? ' tag--paid' : ''}`} style={!paypalConfigured ? { opacity: 0.5 } : undefined}>
              <span className={paypalConfigured ? 'dot dot--live' : 'dot'} />
              {paypalConfigured ? 'PayPal sandbox live' : 'PayPal not configured'}
            </span>
          }
        >
          <InvoiceGrid
            invoices={invoices}
            selectedInvoiceId={selectedInvoice?.invoice_id}
            onSelectInvoice={handleSelectInvoice}
          />
          <div style={{ marginTop: 'clamp(40px, 6vw, 78px)' }}>
            <InvoiceSelector
              invoices={invoices}
              selectedInvoice={selectedInvoice}
              onSelectInvoice={handleSelectInvoice}
              onRunSweep={handleRunSweep}
              isSweeping={isSweeping}
              onAddInvoice={() => setShowAddInvoice(true)}
              onMarkPaid={handleMarkPaid}
              isMarkingPaid={isMarkingPaid}
            />
          </div>
        </Field>

        <Torn from="acid" to="bone" variant={2} />
        <Field
          id="decision"
          tone="bone"
          marker="Your call"
          statement="Nothing goes out until you say so"
        >
          <ApprovalGate
            sweepResult={sweepResult}
            approveResult={approveResult}
            isApproving={isApproving}
            onApprove={handleApprove}
            onReject={handleReject}
            onReset={handleReset}
          />
        </Field>

        <Torn from="bone" to="ink" variant={0} />
        <footer className="field field--ink field--tight" data-field="ink">
          <div className="wrap">
            <h2 className="mega" style={{ marginBottom: 'clamp(28px, 4vw, 56px)' }}>Get paid.</h2>
            <dl className="readouts">
              <div className="readout">
                <dt>Payments</dt>
                <dd style={{ fontSize: '1rem', fontFamily: 'var(--display)', fontWeight: 700 }}>PayPal Orders v2 + webhooks</dd>
              </div>
              <div className="readout">
                <dt>Reasoning</dt>
                <dd style={{ fontSize: '1rem', fontFamily: 'var(--display)', fontWeight: 700 }}>Strands multi-agent graph</dd>
              </div>
              <div className="readout">
                <dt>Model</dt>
                <dd style={{ fontSize: '1rem', fontFamily: 'var(--display)', fontWeight: 700 }}>Gemini</dd>
              </div>
            </dl>
          </div>
        </footer>
      </main>

      {/* Errors sit above everything, out of the reading flow. */}
      {error && (
        <div
          role="alert"
          style={{
            position: 'fixed', left: 'var(--gutter)', bottom: 'var(--gutter)', zIndex: 200,
            maxWidth: 'min(460px, calc(100vw - var(--gutter) * 2))',
            background: 'var(--blood)', color: '#fff',
            border: '2px solid #fff', padding: '18px 20px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
            <strong style={{ fontSize: '1rem', letterSpacing: '-0.02em' }}>{error.error}</strong>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss"
              style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 2, flex: 'none' }}
            >
              <X size={16} />
            </button>
          </div>
          {error.details && (
            <p className="body body--sm" style={{ marginTop: 8 }}>{error.details}</p>
          )}
        </div>
      )}

      {showAddInvoice && (
        <AddInvoiceForm onClose={() => setShowAddInvoice(false)} onCreated={handleInvoiceCreated} />
      )}
    </>
  );
};

export default App;
