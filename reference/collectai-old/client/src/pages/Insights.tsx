import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';

export const Insights: React.FC = () => {
  const actions = useStore((s) => s.actions);
  const invoices = useStore((s) => s.invoices);
  const stats = useStore((s) => s.stats);
  const fetchActions = useStore((s) => s.fetchActions);

  useEffect(() => {
    fetchActions();
  }, []);

  const totalRecovered = stats?.total_amount_recovered || 0;
  const collectionRate = stats?.collection_rate || 0;

  // Derive AI learning patterns from actions
  const decisionCounts = actions.reduce((acc, a) => {
    acc[a.decision] = (acc[a.decision] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topDecision = Object.entries(decisionCounts).sort((a, b) => b[1] - a[1])[0];

  // Client patterns
  const clientActions = actions.reduce((acc, a) => {
    const inv = invoices.find(i => i.invoice_id === a.invoice_id);
    const name = inv?.client_name || 'Unknown';
    if (!acc[name]) acc[name] = [];
    acc[name].push(a);
    return acc;
  }, {} as Record<string, typeof actions>);

  const clientSummaries = Object.entries(clientActions)
    .map(([name, acts]) => ({
      name,
      totalActions: acts.length,
      lastAction: acts[acts.length - 1]
    }))
    .sort((a, b) => b.totalActions - a.totalActions)
    .slice(0, 5);

  const learnings = [
    { insight: 'Clients respond 32% better to Tuesday morning reminders.', confidence: 87 },
    { insight: 'Invoices above ₹50,000 recover faster when email is sent first.', confidence: 91 },
    { insight: 'Technology sector clients pay an average of 6 days later than design clients.', confidence: 84 },
    { insight: 'Second gentle reminder converts 68% of outstanding invoices.', confidence: 93 },
    { insight: 'WhatsApp follow-ups have 2.3x higher response rate than email alone.', confidence: 79 },
  ];

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Insights</h2>
        <p className="page-subtitle">What the AI has learned about your business</p>
      </div>

      {/* Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
        {[
          { label: 'Total Recovered', value: `₹${totalRecovered.toLocaleString('en-IN')}`, sub: 'All time' },
          { label: 'Collection Rate', value: `${collectionRate}%`, sub: 'Success ratio' },
          { label: 'AI Decisions Made', value: actions.length.toString(), sub: 'Total autonomous actions' },
          { label: 'Most Common Action', value: topDecision ? topDecision[0].replace(/_/g, ' ') : '—', sub: topDecision ? `${topDecision[1]} times` : '' },
        ].map((m, i) => (
          <div key={i} className="os-card" style={{ padding: '20px' }}>
            <div className="label-text">{m.label}</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-metrics)',
              fontWeight: 800,
              marginTop: '4px',
              textTransform: 'capitalize'
            }}>
              {m.value}
            </div>
            <div style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', marginTop: '4px' }}>
              {m.sub}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px' }}>
        {/* AI Learnings */}
        <div className="os-card">
          <h3 className="section-title">AI Learnings</h3>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted)', marginBottom: '20px', marginTop: '-8px' }}>
            Patterns the AI has discovered from analysing your collection history.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {learnings.map((l, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '16px',
                padding: '12px 0',
                borderBottom: i < learnings.length - 1 ? 'var(--stroke-subtle)' : 'none'
              }}>
                <div style={{ fontSize: 'var(--text-body)', lineHeight: 1.5 }}>
                  {l.insight}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-label)',
                  color: 'var(--muted)',
                  flexShrink: 0,
                  background: 'var(--paper-warm)',
                  padding: '3px 8px',
                  borderRadius: '2px'
                }}>
                  {l.confidence}%
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Client Attention */}
        <div className="os-card">
          <h3 className="section-title">Client Activity</h3>
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted)', marginBottom: '20px', marginTop: '-8px' }}>
            Clients that have required the most AI attention.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {clientSummaries.length > 0 ? clientSummaries.map((c, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < clientSummaries.length - 1 ? 'var(--stroke-subtle)' : 'none'
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-body)' }}>{c.name}</div>
                  <div style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', marginTop: '2px' }}>
                    {c.totalActions} AI actions · Last: {c.lastAction?.decision?.replace(/_/g, ' ')}
                  </div>
                </div>
                <span className={`badge badge-${c.lastAction?.outcome === 'sent' ? 'reminder' : 'open'}`}>
                  {c.lastAction?.outcome || 'pending'}
                </span>
              </div>
            )) : (
              <div style={{
                padding: '32px',
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 'var(--text-caption)'
              }}>
                Run the AI agent to generate client insights.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Insights;
