import React, { useState, useEffect } from 'react';
import type { SweepResult, ApproveResult, DraftedMessage } from '../types';
import {
  CheckCircle2,
  XCircle,
  Edit3,
  Mail,
  MessageSquare,
  RotateCcw,
} from 'lucide-react';

interface ApprovalGateProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isApproving: boolean;
  onApprove: (draft: DraftedMessage, editedBody?: string) => void;
  onReject: (draft: DraftedMessage) => void;
  onReset: () => void;
}

export const ApprovalGate: React.FC<ApprovalGateProps> = ({
  sweepResult,
  approveResult,
  isApproving,
  onApprove,
  onReject,
  onReset,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedBody, setEditedBody] = useState('');
  const [editedSubject, setEditedSubject] = useState('');

  // Synchronize draft message when sweepResult changes
  useEffect(() => {
    if (sweepResult?.draft) {
      setEditedBody(sweepResult.draft.body);
      setEditedSubject(sweepResult.draft.subject);
      setIsEditing(false);
    }
  }, [sweepResult]);

  if (!sweepResult) {
    return (
      <div
        className="os-card text-center"
        style={{
          padding: '48px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          background: 'var(--paper-warm)',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'var(--yellow)',
            border: 'var(--stroke)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
          }}
        >
          ⚡
        </div>
        <h3
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 800,
          }}
        >
          Approval Gate Standby
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.82rem',
            color: 'var(--muted)',
            maxWidth: '480px',
          }}
        >
          Run an agent sweep above to evaluate invoice risk, forecast recovery probability,
          and produce a draft message awaiting human review.
        </p>
      </div>
    );
  }

  const { draft, plan, risk, probability, invoice } = sweepResult;

  // Case A: Plan chose branch="no_action" (e.g. probability >= 85)
  if (!draft || plan.branch === 'no_action') {
    return (
      <div
        className="os-card"
        style={{
          padding: '28px',
          borderLeft: '10px solid var(--mint-dark)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="stamp-overlay stamp-approved">NO ACTION REQUIRED</span>
            <span className="badge badge-low">BRANCH: NO_ACTION</span>
          </div>

          <button onClick={onReset} className="secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
            <RotateCcw size={14} />
            <span>Reset Evaluation</span>
          </button>
        </div>

        <div>
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.35rem',
              fontWeight: 800,
            }}
          >
            Autonomous Agent Decision: Human Intervention Suppressed
          </h3>
          <p
            style={{
              marginTop: '6px',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.92rem',
              lineHeight: 1.5,
              color: 'var(--ink)',
            }}
          >
            Payment probability is high (<strong>{probability.probability}%</strong>). The Strands
            Agent graph determined this invoice will resolve naturally without follow-up messaging,
            safeguarding the relationship score (<strong>{invoice.relationship_score}/100</strong>).
          </p>
        </div>

        <div
          style={{
            background: 'var(--paper-warm)',
            border: 'var(--stroke-subtle)',
            padding: '14px',
            borderRadius: '3px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.82rem',
          }}
        >
          <div className="label-text" style={{ marginBottom: '4px' }}>Agent Reasoning:</div>
          <div>{plan.reasoning}</div>
        </div>
      </div>
    );
  }

  // Case B: Draft is present and awaiting or completed human review
  const isDecided = approveResult !== null;
  const isApproved = approveResult?.status === 'sent (mock)' || approveResult?.status === 'sent';
  const isRejected = approveResult?.status === 'skipped';

  const handleApproveClick = () => {
    const hasEdits = isEditing && editedBody !== draft.body;
    onApprove(
      {
        ...draft,
        subject: editedSubject,
        body: editedBody,
      },
      hasEdits ? editedBody : undefined
    );
  };

  const handleRejectClick = () => {
    onReject(draft);
  };

  return (
    <div
      className="os-card"
      style={{
        padding: '28px',
        borderLeft: isDecided
          ? isApproved
            ? '10px solid var(--mint-dark)'
            : '10px solid var(--red)'
          : '10px solid var(--yellow)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* Top Bar: Stamps, Badges, Decision Status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: 'var(--stroke-subtle)',
          paddingBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {isDecided ? (
            isApproved ? (
              <span className="stamp-overlay stamp-approved">✓ APPROVED & DISPATCHED</span>
            ) : (
              <span className="stamp-overlay stamp-rejected">✕ REJECTED BY REVIEWER</span>
            )
          ) : (
            <span className="stamp-overlay stamp-pending">⚖️ AWAITING APPROVAL</span>
          )}

          <span className="badge badge-channel">
            {draft.channel === 'whatsapp' ? <MessageSquare size={13} /> : <Mail size={13} />}
            {draft.channel.toUpperCase()}
          </span>

          <span
            className={`badge badge-${
              risk.category === 'Critical'
                ? 'critical'
                : risk.category === 'High'
                ? 'high'
                : risk.category === 'Medium'
                ? 'medium'
                : 'low'
            }`}
          >
            RISK: {risk.category} ({risk.score}/100)
          </span>

          <span className="badge badge-branch">TONE: {plan.tone.toUpperCase()}</span>
        </div>

        {isDecided && (
          <button
            onClick={onReset}
            className="secondary"
            style={{ padding: '6px 14px', fontSize: '0.8rem' }}
          >
            <RotateCcw size={14} />
            <span>Reset Evaluation</span>
          </button>
        )}
      </div>

      {/* Draft Context Summary */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--paper-warm)',
          padding: '12px 16px',
          borderRadius: '3px',
          border: 'var(--stroke-subtle)',
        }}
      >
        <div>
          <span className="label-text">Recipient</span>
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: '1.05rem' }}>
            {invoice.client_name}
          </div>
        </div>

        <div>
          <span className="label-text">Invoice Reference</span>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem' }}>
            {invoice.invoice_id} · ₹{invoice.amount.toLocaleString('en-IN')}
          </div>
        </div>

        <div>
          <span className="label-text">Recovery Forecast</span>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', fontWeight: 700 }}>
            {probability.probability}% probability
          </div>
        </div>
      </div>

      {/* Message Subject */}
      <div>
        <div className="label-text" style={{ marginBottom: '6px' }}>
          Draft Subject Line
        </div>
        {isEditing && !isDecided ? (
          <input
            type="text"
            value={editedSubject}
            onChange={(e) => setEditedSubject(e.target.value)}
            style={{ width: '100%', fontWeight: 600, fontFamily: 'var(--font-sans)' }}
          />
        ) : (
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--white)',
              border: 'var(--stroke)',
              borderRadius: '3px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              fontSize: '0.95rem',
            }}
          >
            {isEditing ? editedSubject : draft.subject}
          </div>
        )}
      </div>

      {/* Message Body */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}
        >
          <span className="label-text">Draft Communication Content</span>
          {isEditing && !isDecided && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem',
                color: 'var(--muted)',
              }}
            >
              {editedBody.length} characters
            </span>
          )}
        </div>

        {isEditing && !isDecided ? (
          <textarea
            rows={7}
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            style={{
              width: '100%',
              fontSize: '0.9rem',
              fontFamily: 'var(--font-mono)',
              background: 'var(--white)',
            }}
          />
        ) : (
          <div
            style={{
              padding: '16px',
              background: 'var(--white)',
              border: 'var(--stroke)',
              borderRadius: '3px',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.88rem',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {approveResult?.final_body || (isEditing ? editedBody : draft.body)}
          </div>
        )}
      </div>

      {/* Action Buttons: Approve / Edit / Reject */}
      {!isDecided && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingTop: '8px',
          }}
        >
          {isEditing ? (
            <>
              <button
                className="btn-approve"
                onClick={handleApproveClick}
                disabled={isApproving}
                style={{ flex: 1, minWidth: '180px' }}
              >
                <CheckCircle2 size={16} />
                <span>{isApproving ? 'Executing...' : 'Approve with Edits'}</span>
              </button>

              <button
                className="secondary"
                onClick={() => {
                  setEditedBody(draft.body);
                  setEditedSubject(draft.subject);
                  setIsEditing(false);
                }}
                disabled={isApproving}
              >
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-approve"
                onClick={handleApproveClick}
                disabled={isApproving}
                style={{ flex: 1, minWidth: '160px' }}
              >
                <CheckCircle2 size={16} />
                <span>{isApproving ? 'Executing...' : 'Approve Draft'}</span>
              </button>

              <button
                className="btn-edit"
                onClick={() => setIsEditing(true)}
                disabled={isApproving}
                style={{ minWidth: '130px' }}
              >
                <Edit3 size={16} />
                <span>Edit Draft</span>
              </button>

              <button
                className="btn-reject"
                onClick={handleRejectClick}
                disabled={isApproving}
                style={{ minWidth: '130px' }}
              >
                <XCircle size={16} />
                <span>Reject</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Execution Outcome & Reflection Card */}
      {approveResult && (
        <div
          style={{
            marginTop: '8px',
            padding: '18px',
            background: isApproved ? 'var(--mint)' : 'var(--paper-warm)',
            border: 'var(--stroke)',
            borderRadius: '3px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '1rem',
              }}
            >
              🧠 Phase 2 Reflection & Execution Outcome
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'var(--ink)',
              }}
            >
              STATUS: {approveResult.status.toUpperCase()}
            </span>
          </div>

          {approveResult.reflection && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '10px',
                background: 'var(--white)',
                padding: '12px',
                border: 'var(--stroke-subtle)',
                borderRadius: '3px',
              }}
            >
              <div>
                <span className="label-text">Optimal Decision</span>
                <div style={{ fontWeight: 700, marginTop: '2px' }}>
                  {approveResult.reflection.was_best_decision ? '✓ Confirmed' : 'Needs Review'}
                </div>
              </div>

              <div>
                <span className="label-text">Relationship Delta</span>
                <div style={{ fontWeight: 700, marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                  {approveResult.reflection.suggested_relationship_delta >= 0 ? '+' : ''}
                  {approveResult.reflection.suggested_relationship_delta} pts
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <span className="label-text">Tone Shift Assessment</span>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.8rem',
                    color: 'var(--muted)',
                    marginTop: '2px',
                  }}
                >
                  {approveResult.reflection.suggested_tone_shift}
                </div>
              </div>
            </div>
          )}

          {isRejected && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                color: 'var(--red)',
              }}
            >
              Reason: {approveResult.reason || 'Draft discarded by human reviewer. No message sent.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
