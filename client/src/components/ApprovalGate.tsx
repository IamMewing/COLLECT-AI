import React, { useState, useEffect } from 'react';
import type { SweepResult, ApproveResult, DraftedMessage } from '../types';
import {
  CheckCircle2,
  XCircle,
  Edit3,
  Mail,
  MessageSquare,
  RotateCcw,
  Brain,
  History,
  ExternalLink,
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
  const [justDecided, setJustDecided] = useState<'approved' | 'rejected' | null>(null);

  // Synchronize draft message when sweepResult changes
  useEffect(() => {
    if (sweepResult?.draft) {
      setEditedBody(sweepResult.draft.body);
      setEditedSubject(sweepResult.draft.subject);
      setIsEditing(false);
    }
  }, [sweepResult]);

  // Flash confirmation animation when approval decision occurs
  useEffect(() => {
    if (approveResult) {
      const isAppr = approveResult.status === 'sent' || approveResult.status === 'sent (mock)';
      setJustDecided(isAppr ? 'approved' : 'rejected');
      const timer = setTimeout(() => setJustDecided(null), 1000);
      return () => clearTimeout(timer);
    }
  }, [approveResult]);

  // ── Standby State ───────────────────────────────────────────────────────────
  if (!sweepResult) {
    return (
      <div
        className="ledger-panel glass-panel"
        style={{
          padding: '48px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '14px',
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            background: 'rgba(255, 210, 63, 0.1)',
            border: '1px solid rgba(255, 210, 63, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            color: 'var(--gold)',
            boxShadow: '0 0 16px rgba(255, 210, 63, 0.15)',
          }}
        >
          ⚡
        </div>
        <h3 className="display-title" style={{ fontSize: '1.25rem' }}>
          Approval Gate Standby
        </h3>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.88rem',
            color: 'var(--text-secondary)',
            maxWidth: '520px',
            lineHeight: 1.6,
          }}
        >
          Trigger an autonomous sweep above. The Strands Agent graph will evaluate loss-at-risk,
          predict recovery probability, decide the action plan, and hold any drafted outreach for human clearance.
        </p>
      </div>
    );
  }

  const { draft, plan, risk, probability, invoice } = sweepResult;

  // ── Case A: Autonomous No-Action Decision (e.g. INV-1043) ───────────────────
  if (!draft || plan.branch === 'no_action') {
    return (
      <div
        className="ledger-panel glass-panel ledger-panel-glow-healthy"
        style={{
          padding: '28px 32px',
          borderLeft: '4px solid var(--healthy)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="stamp stamp-healthy">
              🛡️ NO ACTION REQUIRED · AUTONOMOUS SUPPRESSION
            </span>
            <span className="badge badge-healthy">
              BRANCH: NO_ACTION
            </span>
          </div>

          <button onClick={onReset} className="btn btn-neutral" style={{ padding: '7px 14px', fontSize: '0.78rem' }}>
            <RotateCcw size={13} />
            <span>Reset Evaluation</span>
          </button>
        </div>

        <div>
          <h3
            className="display-title"
            style={{
              fontSize: '1.35rem',
              lineHeight: 1.25,
            }}
          >
            Autonomous Agent Decision: Human Intervention Suppressed
          </h3>
          <p
            style={{
              marginTop: '8px',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.92rem',
              lineHeight: 1.6,
              color: 'var(--text-primary)',
            }}
          >
            Payment probability is projected high at <strong style={{ color: 'var(--healthy)' }}>{probability.probability}%</strong>.
            The Strands graph determined this invoice will resolve naturally without follow-up notices,
            protecting goodwill and the client relationship capital (<strong style={{ color: 'var(--gold)' }}>{invoice.relationship_score}/100</strong>).
          </p>
        </div>

        {/* Agent Reasoning Telemetry */}
        <div
          style={{
            background: 'var(--surface-inset)',
            border: '1px solid var(--border-subtle)',
            padding: '16px 20px',
            borderRadius: '6px',
          }}
        >
          <div className="mono-label" style={{ marginBottom: '6px', color: 'var(--healthy)' }}>
            Gemini Reasoning Telemetry:
          </div>
          <div
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '0.88rem',
              color: 'var(--text-primary)',
              lineHeight: 1.6,
            }}
          >
            {plan.reasoning}
          </div>
        </div>
      </div>
    );
  }

  // ── Case B: Outreach Draft Awaiting or Completed Human Decision ─────────────
  const isDecided = approveResult !== null;
  const isApproved = approveResult?.status === 'sent (mock)' || approveResult?.status === 'sent';
  const isRejected = approveResult?.status === 'skipped';

  const riskBorderClass = risk.category === 'Critical'
    ? 'ledger-panel-glow-critical'
    : risk.category === 'High'
    ? 'ledger-panel-glow-warning'
    : 'ledger-panel-glow-healthy';

  const riskBorderColor = risk.category === 'Critical'
    ? 'var(--critical)'
    : risk.category === 'High'
    ? 'var(--warning)'
    : 'var(--healthy)';

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
      className={`ledger-panel glass-panel ${riskBorderClass} ${justDecided ? 'flash-confirm' : ''}`}
      style={{
        padding: '28px 32px',
        borderLeft: `4px solid ${isDecided ? (isApproved ? 'var(--healthy)' : 'var(--critical)') : riskBorderColor}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '22px',
      }}
    >
      {/* Panel Header: Seals, Badges, Decision Status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          borderBottom: '1px solid var(--border-subtle)',
          paddingBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {isDecided ? (
            isApproved ? (
              <span className="stamp stamp-healthy">
                ✓ APPROVED & DISPATCHED
              </span>
            ) : (
              <span className="stamp stamp-critical">
                ✕ REJECTED BY REVIEWER
              </span>
            )
          ) : (
            <span className="stamp stamp-gold">
              ⚖️ AWAITING HUMAN CLEARANCE
            </span>
          )}

          <span className="badge badge-neutral">
            {draft.channel === 'whatsapp' ? <MessageSquare size={12} /> : <Mail size={12} />}
            {draft.channel.toUpperCase()}
          </span>

          <span
            className={`badge ${
              risk.category === 'Critical'
                ? 'badge-critical'
                : risk.category === 'High'
                ? 'badge-warning'
                : 'badge-healthy'
            }`}
          >
            RISK: {risk.category.toUpperCase()} ({risk.score}/100)
          </span>

          <span className="badge badge-neutral">
            TONE: {plan.tone.toUpperCase()}
          </span>
        </div>

        {isDecided && (
          <button
            onClick={onReset}
            className="btn btn-neutral"
            style={{ padding: '7px 14px', fontSize: '0.78rem' }}
          >
            <RotateCcw size={13} />
            <span>Reset Evaluation</span>
          </button>
        )}
      </div>

      {/* Structured Ledger Context Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          background: 'var(--surface-inset)',
          padding: '14px 18px',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div>
          <span className="mono-label">Target Counterparty</span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', marginTop: '2px' }}>
            {invoice.client_name}
          </div>
        </div>

        <div>
          <span className="mono-label">Ledger Reference</span>
          <div className="mono-data" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            {invoice.invoice_id} · <span style={{ color: 'var(--gold)' }}>₹{invoice.amount.toLocaleString('en-IN')}</span>
          </div>
        </div>

        <div>
          <span className="mono-label">Payment Probability</span>
          <div
            className="mono-data"
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              marginTop: '2px',
              color: probability.probability >= 70 ? 'var(--healthy)' : 'var(--warning)',
            }}
          >
            {probability.probability}% likelihood
          </div>
        </div>
      </div>

      {/* Draft Subject Line Field */}
      <div>
        <div className="mono-label" style={{ marginBottom: '6px' }}>
          Draft Subject Line
        </div>
        {isEditing && !isDecided ? (
          <input
            type="text"
            value={editedSubject}
            onChange={(e) => setEditedSubject(e.target.value)}
            style={{ width: '100%', fontWeight: 600 }}
          />
        ) : (
          <div
            style={{
              padding: '12px 16px',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-active)',
              borderRadius: '6px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
            }}
          >
            {isEditing ? editedSubject : draft.subject}
          </div>
        )}
      </div>

      {/* Draft Message Body Field (Strict High-Contrast Readability) */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '6px',
          }}
        >
          <span className="mono-label">Outreach Message Body</span>
          {isEditing && !isDecided && (
            <span className="mono-data" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {editedBody.length} characters
            </span>
          )}
        </div>

        {isEditing && !isDecided ? (
          <textarea
            rows={8}
            value={editedBody}
            onChange={(e) => setEditedBody(e.target.value)}
            style={{
              width: '100%',
              fontSize: '0.92rem',
              lineHeight: 1.6,
              color: 'var(--text-primary)',
            }}
          />
        ) : (
          <div
            style={{
              padding: '18px 20px',
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-active)',
              borderRadius: '6px',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.94rem',
              color: '#F1F5F9', // Crisp high-contrast off-white
              whiteSpace: 'pre-wrap',
              lineHeight: 1.65,
            }}
          >
            {approveResult?.final_body || (isEditing ? editedBody : draft.body)}
          </div>
        )}
      </div>

      {/* Decision Clearance Buttons: Approve / Edit / Reject */}
      {!isDecided && (
        <div
          style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
            paddingTop: '6px',
          }}
        >
          {isEditing ? (
            <>
              <button
                className="btn btn-approve"
                onClick={handleApproveClick}
                disabled={isApproving}
                style={{ flex: 1, minWidth: '180px', height: '44px' }}
              >
                <CheckCircle2 size={16} />
                <span>{isApproving ? 'Executing...' : 'Approve with Edits'}</span>
              </button>

              <button
                className="btn btn-neutral"
                onClick={() => {
                  setEditedBody(draft.body);
                  setEditedSubject(draft.subject);
                  setIsEditing(false);
                }}
                disabled={isApproving}
                style={{ height: '44px' }}
              >
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-approve"
                onClick={handleApproveClick}
                disabled={isApproving}
                style={{ flex: 1, minWidth: '180px', height: '46px', fontSize: '0.92rem' }}
              >
                <CheckCircle2 size={17} />
                <span>{isApproving ? 'Executing Clearance...' : 'Approve Draft'}</span>
              </button>

              <button
                className="btn btn-neutral"
                onClick={() => setIsEditing(true)}
                disabled={isApproving}
                style={{ minWidth: '140px', height: '46px' }}
              >
                <Edit3 size={15} />
                <span>Edit Draft</span>
              </button>

              <button
                className="btn btn-reject"
                onClick={handleRejectClick}
                disabled={isApproving}
                style={{ minWidth: '130px', height: '46px' }}
              >
                <XCircle size={15} />
                <span>Reject</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Phase 2 Reflection & Memory Persisted Card */}
      {approveResult && (
        <div
          style={{
            marginTop: '8px',
            padding: '20px 24px',
            background: 'var(--surface-inset)',
            border: `1px solid ${isApproved ? 'rgba(0, 229, 199, 0.3)' : 'rgba(255, 59, 107, 0.3)'}`,
            borderRadius: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Brain size={16} color="var(--gold)" />
              <span className="display-title" style={{ fontSize: '1.05rem' }}>
                Phase 2 Reflection & Persistent Memory Ledger
              </span>
            </div>

            <span
              className="mono-data"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.74rem',
                fontWeight: 700,
                color: isApproved ? 'var(--healthy)' : 'var(--critical)',
              }}
            >
              STATUS: {approveResult.status.toUpperCase()}
            </span>
          </div>

          {approveResult.reflection && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '12px',
                background: 'var(--surface)',
                padding: '16px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <span className="mono-label">Optimal Strategy Confirmed</span>
                <div style={{ fontWeight: 600, marginTop: '4px', color: 'var(--text-primary)' }}>
                  {approveResult.reflection.was_best_decision ? '✓ Confirmed by Gemini Reflection' : 'Flagged for Review'}
                </div>
              </div>

              <div>
                <span className="mono-label">Relationship Capital Delta</span>
                <div
                  className="mono-data"
                  style={{
                    fontWeight: 700,
                    marginTop: '4px',
                    fontSize: '1.05rem',
                    color: approveResult.reflection.suggested_relationship_delta >= 0 ? 'var(--healthy)' : 'var(--critical)',
                  }}
                >
                  {approveResult.reflection.suggested_relationship_delta >= 0 ? '+' : ''}
                  {approveResult.reflection.suggested_relationship_delta} pts
                </div>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <span className="mono-label">Tone Shift Recommendation</span>
                <div
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.86rem',
                    color: 'var(--text-secondary)',
                    marginTop: '4px',
                    lineHeight: 1.55,
                  }}
                >
                  {approveResult.reflection.suggested_tone_shift}
                </div>
              </div>
            </div>
          )}

          {/* Real PayPal Sandbox Payment Link — present only when PayPal is
              configured and order creation succeeded for this approval */}
          {approveResult.paypal_payment_link && (
            <a
              href={approveResult.paypal_payment_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                background: 'rgba(0, 112, 186, 0.08)',
                border: '1px solid rgba(0, 112, 186, 0.35)',
                borderRadius: '6px',
                textDecoration: 'none',
                color: 'var(--text-primary)',
              }}
            >
              <ExternalLink size={15} color="#0070BA" />
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '0.86rem' }}>
                <strong>Real PayPal sandbox payment link created</strong> — open to approve & pay as the buyer
              </span>
            </a>
          )}

          {/* Client Memory Persistence Notice */}
          {approveResult.client_memory && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.76rem',
                color: 'var(--text-muted)',
              }}
            >
              <History size={13} color="var(--gold)" />
              <span>
                Updated client memory for <strong>{invoice.client_name}</strong>: Current Score{' '}
                <strong style={{ color: 'var(--gold)' }}>{approveResult.client_memory.relationship_score}/100</strong> (
                {approveResult.client_memory.interaction_history?.length || 1} historical interactions logged)
              </span>
            </div>
          )}

          {isRejected && (
            <div className="mono-data" style={{ fontSize: '0.82rem', color: 'var(--critical)' }}>
              Reason: {approveResult.reason || 'Outreach rejected by human reviewer. No communication sent.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
