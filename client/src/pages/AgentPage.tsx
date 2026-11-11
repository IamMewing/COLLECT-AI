import React from 'react';
import { Link } from 'react-router-dom';
import { PageField } from '../components/PageField';
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
    <PageField
        id="agent"
        tone="ink"
        tight
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

        {/* The gate lives INSIDE the same ink field as the pipeline rather
            than in one of its own.

            Two things pushed it here. It used to sit on lime, which is the
            worst surface in the palette for the one screen where you are
            actually proofreading prose that is about to reach a client — so
            it moved to ink. But that left two ink fields stacked, which
            stopped being two fields visually (nothing marks the seam) while
            still paying for two sets of vertical padding: about 160px of
            empty black between the reasoning and the decision. They're one
            continuous act anyway — watch it think, then say yes — so they're
            one field now, parted by a rule. */}
        <hr className="rule rule--hair" style={{ margin: 'clamp(40px, 5.5vw, 72px) 0 clamp(26px, 3.5vw, 42px)' }} />

        <header className="page-head" style={{ marginBottom: 'clamp(24px, 3.5vw, 44px)' }}>
          <div>
            <span className="marker">Your call</span>
            <h2 className="statement"><span>Nothing goes out until you say so</span></h2>
          </div>
        </header>

        <div id="decision">
          <ApprovalGate
            sweepResult={sweepResult}
            approveResult={approveResult}
            isApproving={isApproving}
            onApprove={handleApprove}
            onReject={handleReject}
            onReset={handleReset}
          />
        </div>
    </PageField>
  );
};

export default AgentPage;
