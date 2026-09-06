import React from 'react';
import { useStore } from '../store/useStore';
import { MaskText } from '../components/MaskText';

export const Reflect: React.FC = () => {
  const actions = useStore((state) => state.actions);
  const runAgentCycle = useStore((state) => state.runAgentCycle);

  const getUrgencyColor = (score?: number) => {
    if (!score) return 'var(--ink)';
    if (score > 7) return 'var(--red)';
    if (score > 4) return 'var(--yellow)';
    return 'var(--blue)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '2.5rem', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
          🧠 AI REFLECTIONS & ACTIONS
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', marginTop: '4px' }}>
          CHRONOLOGICAL AUDIT TIMELINE OF AUTONOMOUS DECISION PROCESSES
        </p>
      </div>

      <div className="section-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="primary" onClick={() => runAgentCycle()}>
          ⚡ RUN AGENT CYCLE
        </button>
      </div>

      {actions.length === 0 ? (
        <div className="os-card text-center" style={{ padding: '60px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800, marginBottom: '8px' }}>
            NO AGENT ACTIONS LOGGED YET
          </h3>
          <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            Ensure you have registered overdue contracts in the invoice ledger.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {actions.map((act) => {
            const timeStr = new Date(act.timestamp).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

            return (
              <div 
                key={act.action_id}
                className="os-card"
                style={{
                  borderLeft: `10px solid ${getUrgencyColor(act.urgency_score)}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}
              >
                <div 
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: '12px',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span 
                      className={`stamp-overlay stamp-${
                        act.decision === 'gentle_reminder' ? 'reminder' : 
                        act.decision === 'firm_nudge' ? 'nudge' : 
                        act.decision === 'escalate_to_owner' ? 'escalated' : 'open'
                      }`}
                      style={{ fontSize: '0.62rem', padding: '2px 8px', transform: 'rotate(-2deg)' }}
                    >
                      {act.decision.replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span 
                      className="stamp-overlay stamp-paid"
                      style={{ fontSize: '0.62rem', padding: '2px 8px', transform: 'rotate(-2deg)' }}
                    >
                      OUTCOME: {act.outcome.toUpperCase()}
                    </span>
                  </div>

                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {timeStr}
                  </span>
                </div>

                <div>
                  <span className="label-text">DECISION LOGIC & REASONING</span>
                  <div 
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9rem',
                      background: 'var(--paper-warm)',
                      padding: '16px',
                      border: 'var(--stroke)',
                      marginTop: '4px',
                      lineHeight: '1.4'
                    }}
                  >
                    🧠 <MaskText text={act.reasoning_summary} duration={0.4} stagger={0.01} />
                  </div>
                </div>

                {act.message_sent && (
                  <div>
                    <span className="label-text">DISPATCHED COMMUNICATION MESSAGE</span>
                    <div 
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8rem',
                        background: 'var(--white)',
                        padding: '16px',
                        border: 'var(--stroke)',
                        marginTop: '4px',
                        whiteSpace: 'pre-wrap',
                        overflowX: 'auto',
                        maxHeight: '180px'
                      }}
                    >
                      {act.message_sent}
                    </div>
                  </div>
                )}

                <div 
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.72rem',
                    color: 'var(--muted)',
                    borderTop: '1px solid var(--border)',
                    paddingTop: '12px'
                  }}
                >
                  <span>MODEL CONFIG: <code>{act.gemini_model_used || 'gemini-1.5-flash'}</code></span>
                  {act.urgency_score !== undefined && (
                    <span>URGENCY INDEX: {act.urgency_score}/10</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
