import React, { useEffect, useState, useCallback } from 'react';
import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError } from './types';
import { fetchInvoices, runSweep, approveAndExecute } from './api';
import { Header } from './components/Header';
import { PipelineFlow } from './components/PipelineFlow';
import { InvoiceSelector } from './components/InvoiceSelector';
import { ApprovalGate } from './components/ApprovalGate';
import { AmbientBackground } from './components/AmbientBackground';
import { InteractionLayer } from './components/InteractionLayer';
import { KineticHero } from './components/KineticHero';
import { AddInvoiceForm } from './components/AddInvoiceForm';
import { AlertTriangle, Terminal, X } from 'lucide-react';

export const App: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showAddInvoice, setShowAddInvoice] = useState<boolean>(false);

  // Load sample invoices from server
  const loadInvoices = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchInvoices();
      setInvoices(data);
      if (data.length > 0 && !selectedInvoice) {
        setSelectedInvoice(data[0]);
      }
    } catch (err: any) {
      console.error('Failed to fetch invoices:', err);
      setError({
        error: err.error || 'Server Connectivity Failure',
        details: err.details || 'Ensure the Express server in /server is running on port 3001.',
        stderr: err.stderr || null,
      });
    }
  }, [selectedInvoice]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // Handle invoice selection
  const handleSelectInvoice = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setSweepResult(null);
    setApproveResult(null);
    setError(null);
  };

  // Run agent sweep
  const handleRunSweep = async (inv: Invoice) => {
    try {
      setIsSweeping(true);
      setError(null);
      setApproveResult(null);
      const result = await runSweep(inv);
      setSweepResult(result);
    } catch (err: any) {
      console.error('Sweep execution failed:', err);
      setError({
        error: err.error || 'Agent Sweep Execution Error',
        details: err.details || err.message || 'The Gemini provider may have encountered a rate limit or timeout. State preserved.',
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsSweeping(false);
    }
  };

  // Handle human approval decision
  const handleApprove = async (draft: DraftedMessage, editedBody?: string) => {
    try {
      setIsApproving(true);
      setError(null);
      const outcome = await approveAndExecute({
        draft,
        approved: true,
        edited_body: editedBody,
        client_name: selectedInvoice?.client_name,
        invoice: selectedInvoice || undefined,
      });
      setApproveResult(outcome);
    } catch (err: any) {
      console.error('Approval failed:', err);
      setError({
        error: err.error || 'Approval Execution Failure',
        details: err.details || err.message,
        stderr: err.stderr || null,
        status: err.status,
      });
    } finally {
      setIsApproving(false);
    }
  };

  // Handle human rejection decision
  const handleReject = async (draft: DraftedMessage) => {
    try {
      setIsApproving(true);
      setError(null);
      const outcome = await approveAndExecute({
        draft,
        approved: false,
        client_name: selectedInvoice?.client_name,
        invoice: selectedInvoice || undefined,
      });
      setApproveResult(outcome);
    } catch (err: any) {
      console.error('Rejection failed:', err);
      setError({
        error: err.error || 'Rejection Processing Failure',
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

  return (
    <div className="app-shell">
      <AmbientBackground />
      <InteractionLayer />
      <Header onRefresh={loadInvoices} isLoading={isSweeping || isApproving} />

      <KineticHero />

      <main className="dashboard-container">
        {/* Calm On-Brand Error Banner (Rate limits / Timeouts) */}
        {error && (
          <div
            className="ledger-panel ledger-panel-glow-critical"
            style={{
              padding: '18px 24px',
              borderLeft: '4px solid var(--critical)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--critical)', fontWeight: 700 }}>
                <AlertTriangle size={18} />
                <span className="display-title" style={{ fontSize: '1rem', color: '#F1F5F9' }}>
                  {error.error}
                </span>
              </div>
              <button
                onClick={() => setError(null)}
                className="btn btn-neutral"
                style={{ padding: '4px 8px', background: 'transparent', border: 'none', color: 'var(--text-muted)' }}
              >
                <X size={16} />
              </button>
            </div>

            {error.details && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                {error.details}
              </p>
            )}

            {error.stderr && (
              <div style={{ marginTop: '8px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: 'var(--critical)',
                    marginBottom: '4px',
                  }}
                >
                  <Terminal size={12} /> Captured Diagnostic Output:
                </div>
                <pre
                  style={{
                    background: 'var(--surface-inset)',
                    color: '#FF809B',
                    padding: '12px 14px',
                    borderRadius: '4px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.76rem',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '180px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  {error.stderr}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Live Strands Graph Pipeline (2D, 60fps, full-width Hero) */}
        <div className="reveal d1">
        <PipelineFlow
          sweepResult={sweepResult}
          approveResult={approveResult}
          isSweeping={isSweeping}
          isApproving={isApproving}
          error={error}
          onRetry={selectedInvoice ? () => handleRunSweep(selectedInvoice) : undefined}
        />
        </div>

        {/* Invoice Surveillance Selector (Single-column Stacked) */}
        <InvoiceSelector
          invoices={invoices}
          selectedInvoice={selectedInvoice}
          onSelectInvoice={handleSelectInvoice}
          onRunSweep={handleRunSweep}
          isSweeping={isSweeping}
          onAddInvoice={() => setShowAddInvoice(true)}
        />

        {/* Human-in-the-Loop Approval Gate (Single-column Stacked) */}
        <ApprovalGate
          sweepResult={sweepResult}
          approveResult={approveResult}
          isApproving={isApproving}
          onApprove={handleApprove}
          onReject={handleReject}
          onReset={handleReset}
        />
      </main>

      {showAddInvoice && (
        <AddInvoiceForm onClose={() => setShowAddInvoice(false)} onCreated={handleInvoiceCreated} />
      )}
    </div>
  );
};

export default App;
