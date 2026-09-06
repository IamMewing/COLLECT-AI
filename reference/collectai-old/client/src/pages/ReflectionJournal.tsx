import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';

export const ReflectionJournal: React.FC = () => {
  const actions = useStore((s) => s.actions);
  const invoices = useStore((s) => s.invoices);
  const fetchActions = useStore((s) => s.fetchActions);

  useEffect(() => {
    fetchActions();
  }, []);

  // Group actions by date
  const grouped = actions.reduce((acc, action) => {
    const date = new Date(action.timestamp).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(action);
    return acc;
  }, {} as Record<string, typeof actions>);

  const formatDecision = (d: string) => d.replace(/_/g, ' ');

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Timeline</h2>
        <p className="page-subtitle">Chronological record of every autonomous AI action</p>
      </div>

      {Object.keys(grouped).length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {Object.entries(grouped).map(([date, dateActions]) => (
            <div key={date}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-label)',
                color: 'var(--muted)',
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em'
              }}>
                {date}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {dateActions.map((action, idx) => {
                  const inv = invoices.find(i => i.invoice_id === action.invoice_id);
                  const time = new Date(action.timestamp).toLocaleTimeString('en-IN', {
                    hour: '2-digit', minute: '2-digit'
                  });
                  return (
                    <div key={idx} className="os-card" style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                            <span style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-label)',
                              color: 'var(--muted)'
                            }}>
                              {time}
                            </span>
                            <span style={{ fontWeight: 600, fontSize: 'var(--text-body)' }}>
                              {inv?.client_name || action.invoice_id}
                            </span>
                            <span className={`badge badge-${action.outcome === 'sent' ? 'paid' : action.outcome === 'failed' ? 'escalated' : 'open'}`}>
                              {action.outcome}
                            </span>
                          </div>

                          {/* AI Decision Explanation */}
                          <div style={{
                            fontSize: 'var(--text-caption)',
                            lineHeight: 1.55,
                            color: 'var(--ink)',
                            marginBottom: '8px'
                          }}>
                            Decision: <strong style={{ textTransform: 'capitalize' }}>{formatDecision(action.decision)}</strong>
                          </div>

                          <div style={{
                            fontSize: 'var(--text-caption)',
                            lineHeight: 1.5,
                            color: 'var(--muted)'
                          }}>
                            {action.reasoning_summary}
                          </div>

                          {/* Transparency details */}
                          <div style={{
                            display: 'flex',
                            gap: '16px',
                            marginTop: '10px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-label)',
                            color: 'var(--muted)'
                          }}>
                            <span>Channel: {action.channel}</span>
                            {action.urgency_score !== undefined && (
                              <span>Urgency: {action.urgency_score}/10</span>
                            )}
                            {action.gemini_model_used && (
                              <span>Model: {action.gemini_model_used}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="os-card" style={{ padding: '48px', textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', fontSize: 'var(--text-caption)' }}>
            No AI actions recorded yet. Run the agent from Mission Control to begin building your timeline.
          </p>
        </div>
      )}
    </div>
  );
};

export default ReflectionJournal;
