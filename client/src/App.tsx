import React, { useEffect, useState, useCallback } from 'react';
import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError, PortfolioOutcome } from './types';
import { fetchInvoices, runSweep, approveAndExecute, markInvoicePaid, checkPaypalStatus, fetchAuthStatus } from './api';
import { PasswordGate } from './components/PasswordGate';
import { Boot } from './components/Boot';
import { LiquidBlobs } from './components/LiquidBlobs';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Torn } from './components/Torn';
import { PipelineFlow } from './components/PipelineFlow';
import { PipelineRail } from './components/PipelineRail';
import { InvoiceGrid } from './components/InvoiceGrid';
import { InvoiceSelector } from './components/InvoiceSelector';
import { PortfolioStats } from './components/PortfolioStats';
import { PortfolioSweep } from './components/PortfolioSweep';
import { ApprovalGate } from './components/ApprovalGate';
import { AddInvoiceForm } from './components/AddInvoiceForm';
import { AgentHistory } from './components/AgentHistory';
import { useInView } from './useInView';
import { X } from 'lucide-react';

type Tone = 'mint' | 'ink' | 'coral';

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
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  // 'checking' avoids a flash of either the lock screen or the real app
  // before we know which one is correct. If the status check itself fails
  // (server unreachable), falls open to 'unlocked' — a password gate that's
  // down shouldn't also take the whole demo down with it; the actual data
  // is still protected server-side by auth.requireAuth regardless.
  const [authState, setAuthState] = useState<'checking' | 'locked' | 'unlocked'>('checking');

  useEffect(() => {
    fetchAuthStatus()
      .then((s) => setAuthState(!s.required || s.authenticated ? 'unlocked' : 'locked'))
      .catch(() => setAuthState('unlocked'));
  }, []);

  useEffect(() => {
    if (authState !== 'unlocked') return;
    checkPaypalStatus()
      .then((s) => setPaypalConfigured(s.configured))
      .catch(() => setPaypalConfigured(false));
  }, [authState]);

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

  useEffect(() => { if (authState === 'unlocked') loadInvoices(); }, [loadInvoices, authState]);

  const handleSelectInvoice = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setSweepResult(null);
    setApproveResult(null);
    setError(null);
  };

  /** "Open" on a portfolio-sweep row. A succeeded row already has the full
   *  SweepResult from the batch call — reuse it and jump straight to the
   *  pipeline, no second network round-trip. A failed row has no pipeline
   *  state to show, so instead this surfaces the real failure in the same
   *  error toast the single-invoice path uses (rather than leaving the
   *  person to go dig through Cloud Run logs for why Gemini choked) and
   *  scrolls to where they'd retry it. */
  const handleOpenPortfolioResult = (invoice: Invoice, outcome: PortfolioOutcome) => {
    setSelectedInvoice(invoice);
    setApproveResult(null);
    if (outcome.ok) {
      setError(null);
      setSweepResult(outcome);
      document.getElementById('agent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      setSweepResult(null);
      setError({
        error: `The agent failed on ${invoice.client_name}`,
        details: outcome.details || outcome.error,
        stderr: null,
      });
      document.getElementById('selector')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleRunSweep = async (inv: Invoice) => {
    try {
      setIsSweeping(true);
      setError(null);
      setApproveResult(null);
      /* Go to the reasoning, now, before the work starts — the whole point of
         pressing this is to watch it think. This used to jump to the finished
         draft instead, once the run was over, which meant the graph animated
         through its entire sequence on a part of the page nobody was looking
         at. The rail at the bottom carries the state from here on. */
      document.getElementById('agent')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const result = await runSweep(inv);
      setSweepResult(result);
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
      setHistoryRefreshKey((k) => k + 1);
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
      setHistoryRefreshKey((k) => k + 1);
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

  if (authState === 'checking') {
    // Deliberately blank rather than a spinner — this resolves in one fast
    // same-origin request, and a spinner that appears for a few dozen
    // milliseconds reads as more of a flash than a loading state.
    return <div className="field--ink" style={{ position: 'fixed', inset: 0 }} />;
  }

  if (authState === 'locked') {
    return <PasswordGate onUnlocked={() => setAuthState('unlocked')} />;
  }

  return (
    <>
      <Boot />
      <LiquidBlobs />
      <Nav />

      <main>
        <Hero />

        <Torn from="mint" to="ink" variant={0} />
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

        <Torn from="ink" to="mint" variant={1} />
        <Field
          id="ledger"
          tone="mint"
          marker="The ledger"
          statement="Every account it’s watching"
          aside={
            <span className={`tag${paypalConfigured ? ' tag--paid' : ''}`} style={!paypalConfigured ? { opacity: 0.5 } : undefined}>
              <span className={paypalConfigured ? 'dot dot--live' : 'dot'} />
              {paypalConfigured ? 'PayPal sandbox live' : 'PayPal not configured'}
            </span>
          }
        >
          <PortfolioStats invoices={invoices} />
          <InvoiceGrid
            invoices={invoices}
            selectedInvoiceId={selectedInvoice?.invoice_id}
            onSelectInvoice={handleSelectInvoice}
          />
          <div id="selector" style={{ marginTop: 'clamp(40px, 6vw, 78px)' }}>
            <InvoiceSelector
              invoices={invoices}
              selectedInvoice={selectedInvoice}
              onSelectInvoice={handleSelectInvoice}
              onRunSweep={handleRunSweep}
              isSweeping={isSweeping}
              onAddInvoice={() => setShowAddInvoice(true)}
              onMarkPaid={handleMarkPaid}
              isMarkingPaid={isMarkingPaid}
              onInvoicesImported={loadInvoices}
            />
          </div>
          <PortfolioSweep invoices={invoices} onOpen={handleOpenPortfolioResult} />
        </Field>

        <Torn from="mint" to="coral" variant={2} />
        <Field
          id="decision"
          tone="coral"
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

        <Torn from="coral" to="mint" variant={1} />
        <Field
          id="history"
          tone="mint"
          marker="The record"
          statement="Every message it sent, and who got it"
        >
          <AgentHistory refreshKey={historyRefreshKey} />
        </Field>

        <Torn from="mint" to="ink" variant={2} />
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

      {/* Errors sit above everything, out of the reading flow.
          A real-mode failure's `details` is the agent's actual exception
          message, which can still run long — so this is capped and scrolls
          internally, with the dismiss button kept in its own non-shrinking
          header row. It used to be one unbounded block: a sufficiently long
          `details` (a raw Python traceback once did this before the server
          started trimming it) grew the whole toast past the viewport and
          pushed the × button off the top of the screen with it, leaving no
          way to dismiss it at all. */}
      {error && (
        <div
          role="alert"
          style={{
            position: 'fixed', left: 'var(--gutter)', bottom: 'var(--gutter)', zIndex: 200,
            maxWidth: 'min(460px, calc(100vw - var(--gutter) * 2))',
            maxHeight: 'min(70vh, 480px)',
            display: 'flex', flexDirection: 'column',
            background: 'var(--coral)', color: 'var(--ink)',
            border: '2px solid #fff', overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start',
            flex: 'none', padding: '18px 20px', paddingBottom: error.details ? 8 : 18,
          }}>
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
            <p
              className="body body--sm"
              style={{ margin: 0, padding: '0 20px 18px', overflowY: 'auto', minHeight: 0, whiteSpace: 'pre-wrap' }}
            >
              {error.details}
            </p>
          )}
        </div>
      )}

      <PipelineRail
        sweepResult={sweepResult}
        approveResult={approveResult}
        isSweeping={isSweeping}
        isApproving={isApproving}
        error={error}
        nudged={!!error}
      />

      {showAddInvoice && (
        <AddInvoiceForm onClose={() => setShowAddInvoice(false)} onCreated={handleInvoiceCreated} />
      )}
    </>
  );
};

export default App;
