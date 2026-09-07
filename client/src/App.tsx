import React, { useEffect, useState, useCallback } from 'react';
import type { Invoice, SweepResult, ApproveResult, DraftedMessage, ApiError } from './types';
import { fetchInvoices, runSweep, approveAndExecute } from './api';
import { Header } from './components/Header';
import { WorkflowPipeline } from './components/WorkflowPipeline';
import { InvoiceSelector } from './components/InvoiceSelector';
import { ApprovalGate } from './components/ApprovalGate';
import { AlertCircle, Terminal, X } from 'lucide-react';

export const App: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [approveResult, setApproveResult] = useState<ApproveResult | null>(null);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | null>(null);

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
        error: err.error || 'Could not connect to CollectAI Agent Server',
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
        error: err.error || 'Agent sweep failed',
        details: err.details || err.message,
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
        invoice: selectedInvoice,
      });
      setApproveResult(outcome);
    } catch (err: any) {
      console.error('Approval failed:', err);
      setError({
        error: err.error || 'Failed to approve message',
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
        invoice: selectedInvoice,
      });
      setApproveResult(outcome);
    } catch (err: any) {
      console.error('Rejection failed:', err);
      setError({
        error: err.error || 'Failed to reject message',
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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header onRefresh={loadInvoices} isLoading={isSweeping || isApproving} />

      <main className="app-container">
        {/* Error Notification Banner */}
        {error && (
          <div
            className="os-card"
            style={{
              padding: '16px 20px',
              borderLeft: '8px solid var(--red)',
              background: 'var(--red-soft)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#991B1B', fontWeight: 700 }}>
                <AlertCircle size={18} />
                <span>{error.error}</span>
              </div>
              <button
                onClick={() => setError(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '2px',
                  cursor: 'pointer',
                  color: '#991B1B',
                  boxShadow: 'none',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {error.details && (
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: '0.85rem', color: '#7F1D1D' }}>
                {error.details}
              </p>
            )}

            {error.stderr && (
              <div style={{ marginTop: '6px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: '#991B1B',
                    marginBottom: '4px',
                  }}
                >
                  <Terminal size={12} /> Captured Python stderr:
                </div>
                <pre
                  style={{
                    background: 'var(--ink)',
                    color: '#F87171',
                    padding: '10px 12px',
                    borderRadius: '3px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.75rem',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    maxHeight: '180px',
                  }}
                >
                  {error.stderr}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Workflow Visualizer */}
        <WorkflowPipeline
          sweepResult={sweepResult}
          approveResult={approveResult}
          isSweeping={isSweeping}
          isApproving={isApproving}
        />

        {/* Invoice Selection & Evaluation Trigger */}
        <InvoiceSelector
          invoices={invoices}
          selectedInvoice={selectedInvoice}
          onSelectInvoice={handleSelectInvoice}
          onRunSweep={handleRunSweep}
          isSweeping={isSweeping}
        />

        {/* Approval Gate UI Component */}
        <ApprovalGate
          sweepResult={sweepResult}
          approveResult={approveResult}
          isApproving={isApproving}
          onApprove={handleApprove}
          onReject={handleReject}
          onReset={handleReset}
        />
      </main>
    </div>
  );
};

export default App;
