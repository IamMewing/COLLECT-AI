import React from 'react';
import { Link } from 'react-router-dom';
import { PageField } from '../components/PageField';
import { Torn } from '../components/Torn';
import { PipelineFlow } from '../components/PipelineFlow';
import { ApprovalGate } from '../components/ApprovalGate';
import { useAppState } from '../AppState';
import { Play } from 'lucide-react';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export const AgentPage: React.FC = () => {
  const {
    invoices, selectedInvoice, sweepResult, approveResult,
    isSweeping, isApproving, error,
    handleRunSweep, handleApprove, handleReject, handleReset,
  } = useAppState();

  return (
    <>
      <PageField
        id="agent"
        tone="ink"
        marker="How it thinks"
        statement="It weighs the money and the odds before it writes a word"
        aside={
          selectedInvoice ? (
            <div className="run-bar">
              <div>
                <span className="marker" style={{ marginBottom: 8, display: 'inline-flex' }}>Running on</span>
                <p className="run-bar-name">{selectedInvoice.client_name}</p>
                <p className="mono" style={{ opacity: 0.7 }}>
                  {selectedInvoice.invoice_id} · {inr(selectedInvoice.amount)} · {selectedInvoice.days_overdue}d late
                </p>
              </div>
              <button
                className="pill pill--solid"
                onClick={() => handleRunSweep(selectedInvoice)}
                disabled={isSweeping}
              >
                <Play size={14} /> {isSweeping ? 'Thinking…' : sweepResult ? 'Run again' : 'Run the agent'}
              </button>
            </div>
          ) : null
        }
      >
        {invoices.length === 0 ? (
          <div className="empty">
            <h3 className="title">No accounts to work yet</h3>
            <p className="body" style={{ marginTop: 12, opacity: 0.8 }}>
              The agent needs an overdue invoice before it has anything to reason about.
              Add your first one on the ledger — with a real email or phone number, so it
              has somewhere to actually send.
            </p>
            <Link className="pill pill--lg pill--solid" to="/ledger" style={{ marginTop: 26 }}>
              Go to the ledger
            </Link>
          </div>
        ) : (
          <PipelineFlow
            sweepResult={sweepResult}
            approveResult={approveResult}
            isSweeping={isSweeping}
            isApproving={isApproving}
            error={error}
            onRetry={selectedInvoice ? () => handleRunSweep(selectedInvoice) : undefined}
          />
        )}
      </PageField>

      <Torn from="ink" to="lime" variant={2} />
      <PageField
        id="decision"
        tone="lime"
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
      </PageField>
    </>
  );
};

export default AgentPage;
