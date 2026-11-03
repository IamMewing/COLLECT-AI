import React, { useState, useEffect } from 'react';
import type { SweepResult, ApproveResult, DraftedMessage } from '../types';
import { Check, X, Pencil, RotateCcw, ArrowUpRight } from 'lucide-react';

/** Every draft ends with this token; the server swaps it for a real PayPal
 *  link at the moment of approval. Showing the raw token to the person being
 *  asked to approve the message is just noise, so the read-only view renders
 *  what will actually be sitting there instead. */
const PAYMENT_TOKEN = '{{PAYMENT_LINK}}';
const forReading = (text: string) =>
  text.split(PAYMENT_TOKEN).join('[ a live PayPal link lands here ]');

interface ApprovalGateProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isApproving: boolean;
  onApprove: (draft: DraftedMessage, editedBody?: string) => void;
  onReject: (draft: DraftedMessage) => void;
  onReset: () => void;
}

export const ApprovalGate: React.FC<ApprovalGateProps> = ({
  sweepResult, approveResult, isApproving, onApprove, onReject, onReset,
}) => {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');

  useEffect(() => {
    if (sweepResult?.draft) {
      setBody(sweepResult.draft.body);
      setSubject(sweepResult.draft.subject);
      setEditing(false);
    }
  }, [sweepResult]);

  /* ── Nothing run yet ─────────────────────────────────────────────────── */
  if (!sweepResult) {
    return (
      <div className="slab" style={{ textAlign: 'center', padding: 'clamp(40px, 7vw, 86px) 24px' }}>
        <h3 className="title" style={{ marginBottom: 14 }}>Nothing to review yet</h3>
        <p className="body" style={{ margin: '0 auto', opacity: 0.7 }}>
          Pick an account above and run the agent. It will score the risk, work out whether
          chasing is even worth it, and only then write something for you to approve.
        </p>
      </div>
    );
  }

  const { draft, plan, risk, probability, invoice } = sweepResult;

  /* ── Agent chose silence ─────────────────────────────────────────────── */
  if (!draft || plan.branch === 'no_action') {
    return (
      <div className="slab">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
          <span className="tag tag--paid">Left alone on purpose</span>
          <button onClick={onReset} className="pill pill--sm">
            <RotateCcw size={13} /> Start over
          </button>
        </div>

        <h3 className="statement" style={{ marginBottom: 18 }}>
          The agent decided not to chase this one
        </h3>
        <p className="body" style={{ marginBottom: 24 }}>
          {invoice.client_name} is {probability.probability}% likely to pay without being
          asked, and their standing is {invoice.relationship_score}/100. Sending a reminder
          here costs goodwill and buys nothing.
        </p>

        <hr className="rule rule--hair" />
        <p className="body body--sm" style={{ marginTop: 20, opacity: 0.75 }}>
          {plan.reasoning}
        </p>
      </div>
    );
  }

  /* ── A draft is on the table ─────────────────────────────────────────── */
  const decided = approveResult !== null;
  const sent = approveResult?.status === 'sent' || approveResult?.status === 'sent (mock)';
  const risky = risk.category === 'Critical' || risk.category === 'High';

  const approve = () => {
    const edited = editing && body !== draft.body;
    onApprove({ ...draft, subject, body }, edited ? body : undefined);
  };

  return (
    <div className="slab">
      {/* state strip */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {decided ? (
            <span className={`stamp${sent ? '' : ''}`} style={{ color: sent ? 'var(--ok)' : 'var(--warn)' }}>
              {sent ? <><Check size={18} /> Sent</> : <><X size={18} /> Not sent</>}
            </span>
          ) : (
            <span className="tag" style={{ borderWidth: 3 }}>
              <span className="dot dot--live" /> Waiting on you
            </span>
          )}
          <span className={`tag${risky ? ' tag--risk' : ''}`}>{risk.category} risk</span>
          <span className={`tag${risky ? ' tag--risk' : ''}`}>{risk.score}/100</span>
          {/* Escalation is a distinct decision, not just a firmer tone — the
              agent is saying "I've been here before and it didn't work" — so
              it earns its own warning-coloured tag rather than blending into
              the tone tag next to it. */}
          {plan.branch === 'escalation' && <span className="tag tag--risk">Escalated</span>}
          <span className="tag" style={{ opacity: 0.6 }}>{plan.tone} tone</span>
        </div>

        {decided && (
          <button onClick={onReset} className="pill pill--sm">
            <RotateCcw size={13} /> Start over
          </button>
        )}
      </div>

      {/* who / what / odds */}
      <dl className="readouts" style={{ marginBottom: 'clamp(22px, 3vw, 34px)' }}>
        <div className="readout">
          <dt>Going to</dt>
          <dd style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.2rem)', fontFamily: 'var(--display)', fontWeight: 900, letterSpacing: '-0.02em' }}>
            {invoice.client_name}
          </dd>
        </div>
        <div className="readout">
          <dt>Invoice</dt>
          <dd style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.2rem)' }}>{invoice.invoice_id}</dd>
        </div>
        <div className="readout">
          <dt>Amount</dt>
          <dd>₹{invoice.amount.toLocaleString('en-IN')}</dd>
        </div>
        <div className="readout">
          <dt>Chance they pay</dt>
          <dd style={{ color: probability.probability >= 60 ? 'var(--ok)' : 'var(--warn)' }}>
            {probability.probability}<small>%</small>
          </dd>
        </div>
        <div className="readout">
          <dt>Channel</dt>
          <dd style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.2rem)' }}>{draft.channel}</dd>
        </div>
      </dl>

      {/* the letter */}
      <div style={{ marginBottom: 20 }}>
        <span className="lbl">Subject</span>
        {editing && !decided ? (
          <input className="inp" value={subject} onChange={(e) => setSubject(e.target.value)} />
        ) : (
          <p style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em', borderBottom: '2px solid currentColor', paddingBottom: 12 }}>
            {editing ? subject : draft.subject}
          </p>
        )}
      </div>

      <div style={{ marginBottom: 'clamp(22px, 3vw, 32px)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="lbl">Message</span>
          {editing && !decided && (
            <span className="mono" style={{ opacity: 0.5, fontSize: '0.72rem' }}>{body.length} characters</span>
          )}
        </div>
        {editing && !decided ? (
          <>
            <textarea className="inp" rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="mono" style={{ marginTop: 8, opacity: 0.6, fontSize: '0.74rem' }}>
              Keep {PAYMENT_TOKEN} wherever you want the PayPal link to appear.
            </p>
          </>
        ) : (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              lineHeight: 1.68,
              fontSize: '0.97rem',
              borderLeft: '3px solid currentColor',
              paddingLeft: 18,
            }}
          >
            {forReading(approveResult?.final_body || (editing ? body : draft.body))}
          </div>
        )}
      </div>

      {/* decision */}
      {!decided && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {editing ? (
            <>
              <button className="pill pill--lg pill--solid" onClick={approve} disabled={isApproving}>
                {isApproving ? <span className="spin" /> : <Check size={16} />} Send with my edits
              </button>
              <button
                className="pill pill--lg"
                disabled={isApproving}
                onClick={() => { setBody(draft.body); setSubject(draft.subject); setEditing(false); }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button className="pill pill--lg pill--solid" onClick={approve} disabled={isApproving}>
                {isApproving ? <span className="spin" /> : <Check size={16} />} Send it
              </button>
              <button className="pill pill--lg" onClick={() => setEditing(true)} disabled={isApproving}>
                <Pencil size={15} /> Edit first
              </button>
              <button className="pill pill--lg pill--stop" onClick={() => onReject(draft)} disabled={isApproving}>
                <X size={15} /> Don’t send
              </button>
            </>
          )}
        </div>
      )}

      {/* aftermath */}
      {approveResult && (
        <div style={{ marginTop: 'clamp(26px, 4vw, 40px)', borderTop: '2px solid currentColor', paddingTop: 'clamp(22px, 3vw, 30px)' }}>
          {approveResult.paypal_payment_link && (
            <a
              className="pill pill--solid"
              href={approveResult.paypal_payment_link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginBottom: 24 }}
            >
              <ArrowUpRight size={15} /> Open the PayPal link that went out
            </a>
          )}

          {approveResult.reflection && (
            <>
              <h4 className="title" style={{ marginBottom: 18 }}>What the agent learned</h4>
              <dl className="readouts">
                <div className="readout">
                  <dt>Right call?</dt>
                  <dd style={{ fontSize: '1rem', fontFamily: 'var(--display)', fontWeight: 900 }}>
                    {approveResult.reflection.was_best_decision ? 'Yes' : 'Flagged for review'}
                  </dd>
                </div>
                <div className="readout">
                  <dt>Standing change</dt>
                  <dd style={{ color: approveResult.reflection.suggested_relationship_delta >= 0 ? 'var(--ok)' : 'var(--warn)' }}>
                    {approveResult.reflection.suggested_relationship_delta >= 0 ? '+' : ''}
                    {approveResult.reflection.suggested_relationship_delta}
                  </dd>
                </div>
                <div className="readout" style={{ gridColumn: '1 / -1' }}>
                  <dt>Next time</dt>
                  <dd style={{ fontSize: '0.95rem', fontFamily: 'var(--display)', fontWeight: 500, lineHeight: 1.5, letterSpacing: 0 }}>
                    {approveResult.reflection.suggested_tone_shift}
                  </dd>
                </div>
              </dl>
            </>
          )}

          {approveResult.client_memory && (
            <p className="mono" style={{ marginTop: 18, opacity: 0.6, fontSize: '0.76rem' }}>
              {invoice.client_name} now sits at {approveResult.client_memory.relationship_score}/100
              across {approveResult.client_memory.interaction_history?.length || 1} logged interactions.
            </p>
          )}

          {!sent && (
            <p className="body body--sm" style={{ marginTop: 16, color: 'var(--warn)' }}>
              {approveResult.reason || 'You stopped this one. Nothing was sent.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ApprovalGate;
