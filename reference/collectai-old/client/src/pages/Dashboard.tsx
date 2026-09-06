import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { useAgentStore } from '../store/agentStore';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';
import { useSSE } from '../hooks/useSSE';
import gsap from 'gsap';

// ─── Typewriter Component ───
const Typewriter: React.FC<{ lines: string[]; delay?: number; speed?: number; onComplete?: () => void }> = ({
  lines, delay = 0, speed = 30, onComplete
}) => {
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [currentLine, setCurrentLine] = useState(0);
  const [currentChar, setCurrentChar] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  useEffect(() => {
    if (!started || currentLine >= lines.length) {
      if (started && currentLine >= lines.length && onComplete) onComplete();
      return;
    }
    const line = lines[currentLine];
    if (currentChar <= line.length) {
      const timer = setTimeout(() => {
        setDisplayedLines(prev => {
          const updated = [...prev];
          updated[currentLine] = line.substring(0, currentChar);
          return updated;
        });
        setCurrentChar(c => c + 1);
      }, speed);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        setCurrentLine(l => l + 1);
        setCurrentChar(0);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [started, currentLine, currentChar, lines, speed, onComplete]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {displayedLines.map((line, i) => (
        <span key={i} style={{
          opacity: i === currentLine ? 1 : 0.7,
          transition: 'opacity 0.3s'
        }}>
          {line}
          {i === currentLine && currentChar <= lines[currentLine]?.length && (
            <span style={{
              display: 'inline-block',
              width: '2px',
              height: '1.1em',
              background: 'var(--ink)',
              marginLeft: '2px',
              verticalAlign: 'text-bottom',
              animation: 'blink 1s step-end infinite'
            }} />
          )}
        </span>
      ))}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
};

// ─── Animated Counter ───
const AnimCounter: React.FC<{ value: number; prefix?: string; duration?: number }> = ({
  value, prefix = '', duration = 1.5
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current,
      { innerText: 0 },
      {
        innerText: value,
        duration,
        ease: 'power2.out',
        snap: { innerText: 1 },
        onUpdate: function () {
          if (ref.current) {
            ref.current.textContent = prefix + Math.round(Number(gsap.getProperty(ref.current, 'innerText') || 0)).toLocaleString('en-IN');
          }
        }
      }
    );
  }, [value, prefix, duration]);
  return <span ref={ref}>{prefix}0</span>;
};

// ─── Live Stage Definition ───
type StageStatus = 'pending' | 'executing' | 'done' | 'error';

interface LiveStage {
  id: string;
  label: string;
  icon: string;
  status: StageStatus;
}

// Default stages — populated from SSE on "Watch AI Work"
const DEFAULT_STAGES: LiveStage[] = [
  { id: 'init',     label: 'Starting Collection Cycle',      icon: '⚡', status: 'pending' },
  { id: 'fetch',    label: 'Fetching Overdue Invoices',      icon: '📋', status: 'pending' },
  { id: 'client',   label: 'Loading Client Profiles',        icon: '👤', status: 'pending' },
  { id: 'history',  label: 'Reading Payment History',        icon: '📖', status: 'pending' },
  { id: 'risk',     label: 'Calculating Risk Scores',        icon: '📊', status: 'pending' },
  { id: 'evaluate', label: 'Evaluating Collection Strategy', icon: '🎯', status: 'pending' },
  { id: 'gemini',   label: 'Calling Gemini AI',              icon: '🧠', status: 'pending' },
  { id: 'draft',    label: 'Generating Reminder Messages',   icon: '✍️',  status: 'pending' },
  { id: 'save',     label: 'Saving AI Reasoning',            icon: '💾', status: 'pending' },
  { id: 'update',   label: 'Updating Firestore',             icon: '🔄', status: 'pending' },
  { id: 'complete', label: 'Collection Cycle Complete',      icon: '✅', status: 'pending' },
];

// ─── Live AI Decision Timeline ───
const AITimeline: React.FC<{ stages: LiveStage[]; isActive: boolean }> = ({ stages, isActive }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
    {stages.map((stage, i) => {
      const isDone = stage.status === 'done';
      const isExecuting = stage.status === 'executing';
      const isError = stage.status === 'error';
      const isPending = stage.status === 'pending';

      return (
        <div key={stage.id} style={{
          display: 'flex',
          gap: '14px',
          alignItems: 'flex-start',
          padding: '10px 0',
          opacity: isDone ? 0.55 : isExecuting ? 1 : isPending && isActive ? 0.3 : isPending ? 0.2 : 1,
          transition: 'opacity 0.4s ease'
        }}>
          {/* Timeline line + dot */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '24px', flexShrink: 0 }}>
            <div style={{
              width: '10px', height: '10px',
              borderRadius: '50%',
              background: isDone ? 'var(--mint)' : isExecuting ? 'var(--yellow)' : isError ? 'var(--red)' : 'var(--border)',
              border: isExecuting ? '2px solid var(--ink)' : isDone ? '1.5px solid var(--muted)' : '1.5px solid var(--border)',
              transition: 'all 0.35s ease',
              transform: isExecuting ? 'scale(1.4)' : 'scale(1)',
              boxShadow: isExecuting ? '0 0 8px rgba(255,212,0,0.5)' : 'none',
            }} />
            {i < stages.length - 1 && (
              <div style={{
                width: '1.5px',
                height: '28px',
                background: isDone ? 'var(--muted)' : 'var(--border)',
                transition: 'background 0.3s'
              }} />
            )}
          </div>
          {/* Content */}
          <div style={{ paddingTop: '0' }}>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-caption)',
              fontWeight: isExecuting ? 700 : 500,
              color: isExecuting ? 'var(--ink)' : isDone ? 'var(--muted)' : 'var(--ink)',
            }}>
              {stage.icon} {stage.label}
            </div>
            {isExecuting && (
              <div style={{
                fontSize: 'var(--text-label)',
                color: 'var(--muted)',
                marginTop: '3px',
                fontFamily: 'var(--font-mono)'
              }}>
                Processing...
              </div>
            )}
            {isDone && (
              <div style={{
                fontSize: 'var(--text-label)',
                color: 'var(--mint)',
                marginTop: '2px',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.03em'
              }}>
                ✓ Complete
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>
);


// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════
export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const stats = useStore((s) => s.stats);
  const invoices = useStore((s) => s.invoices);
  const runAgentCycle = useStore((s) => s.runAgentCycle);
  const loadAllData = useStore((s) => s.loadAllData);
  const businesses = useStore((s) => s.businesses);
  const selectedBusinessId = useStore((s) => s.selectedBusinessId);
  const highlightedInvoiceId = useAgentStore((s) => s.highlightedInvoiceId);

  const [agentStatus, setAgentStatus] = useState('Idle');
  type AgentState = 'idle' | 'processing' | 'completed' | 'error';
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [watching, setWatching] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [liveStages, setLiveStages] = useState<LiveStage[]>(DEFAULT_STAGES);
  const [cycleResult, setCycleResult] = useState<{ invoicesEvaluated: number; decisions: Record<string, number> } | null>(null);

  const activeBusiness = businesses.find(b => b.business_id === selectedBusinessId);
  const ownerName = user?.displayName || activeBusiness?.name?.split(' ')[0] || 'there';

  // Agent status polling — uses real Firebase ID token
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const { auth } = await import('../firebase/config');
        if (!auth.currentUser) return;
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/api/agent/status', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status) setAgentStatus(data.status);
      } catch { /* ignore */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 8000);
    return () => clearInterval(interval);
  }, [user]);

  // ── SSE — Listen for real backend stage events ──
  useSSE(activeJobId, {
    onInit: (event) => {
      // Populate stages from initial snapshot
      if (event.stages) {
        setLiveStages(event.stages.map(s => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          status: s.status as StageStatus
        })));
      }
    },
    onStage: (event) => {
      if (!event.stage) return;
      setLiveStages(prev =>
        prev.map(s =>
          s.id === event.stage!.id
            ? { ...s, status: event.stage!.status as StageStatus }
            : s
        )
      );
    },
    onComplete: (event) => {
      setWatching(false);
      setAgentState('completed');
      if (event.stages) {
        setLiveStages(event.stages.map(s => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          status: s.status as StageStatus
        })));
      }
      if (event.result) {
        setCycleResult(event.result as any);
        const { decisions, invoicesEvaluated } = event.result;
        const parts = [
          `Evaluated ${invoicesEvaluated} invoice${invoicesEvaluated !== 1 ? 's' : ''}`,
          (decisions as any).gentle_reminder > 0 ? `${(decisions as any).gentle_reminder} reminders` : '',
          (decisions as any).firm_nudge > 0 ? `${(decisions as any).firm_nudge} nudges` : '',
          (decisions as any).escalate_to_owner > 0 ? `${(decisions as any).escalate_to_owner} escalations` : '',
        ].filter(Boolean).join(' · ');
        useStore.getState().addToast(`Collection cycle complete: ${parts}`, 'success');
      }
      // Reload all data to reflect Firestore changes
      loadAllData();
      setActiveJobId(null);
    },
    onError: (event) => {
      setWatching(false);
      setAgentState('error');
      if (event.stages) {
        setLiveStages(event.stages.map(s => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          status: s.status as StageStatus
        })));
      }
      useStore.getState().addToast(`Collection cycle failed: ${event.error}`, 'error');
      setActiveJobId(null);
    },
  });

  // "Watch AI Work" — triggers real backend cycle, opens SSE stream
  const handleWatchLive = useCallback(async () => {
    if (agentState === 'processing') return;
    setWatching(true);
    setAgentState('processing');
    setCycleResult(null);
    // Reset all stages to pending
    setLiveStages(DEFAULT_STAGES.map(s => ({ ...s, status: 'pending' })));

    const jobId = await runAgentCycle();
    if (jobId) {
      setActiveJobId(jobId);
    } else {
      // Failed to start — reset
      setWatching(false);
      setAgentState('error');
      setLiveStages(DEFAULT_STAGES.map(s => ({ ...s, status: 'pending' })));
    }
  }, [agentState, runAgentCycle]);

  const recovered = stats?.total_amount_recovered || 0;
  const outstanding = stats?.total_amount_outstanding || 0;
  const openCount = stats?.open_invoices || 0;
  const hoursSaved = stats?.estimated_hours_saved || 0;
  const messagesSent = stats?.messages_sent || 0;

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // Compute stats from real invoice data
  const totalCount = invoices.length;
  const paidCount = invoices.filter(i => i.status === 'paid').length;
  const overdueCount = invoices.filter(i => {
    if (i.status === 'paid' || i.status === 'closed') return false;
    return new Date(i.due_date) < new Date();
  }).length;
  const recoveryRate = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;
  const computedHealthScore = totalCount === 0 ? 0 : Math.min(100, Math.max(0, recoveryRate + 10 - (overdueCount * 2)));



  const briefLines = totalCount === 0
    ? [
        `${getGreeting()}, ${ownerName}.`,
        `Welcome to CollectAI.`,
        `Your workspace is active and ready.`,
        `No invoices exist yet.`,
        `Create your first invoice to activate autonomous recovery.`,
      ]
    : [
        `${getGreeting()}, ${ownerName}.`,
        `${totalCount} invoice${totalCount !== 1 ? 's' : ''} in workspace.`,
        outstanding > 0 ? `Outstanding: ₹${outstanding.toLocaleString('en-IN')}.` : 'No outstanding amounts.',
        overdueCount > 0 ? `${overdueCount} invoice${overdueCount !== 1 ? 's are' : ' is'} overdue.` : 'No overdue invoices.',
        recoveryRate > 0 ? `Recovery rate: ${recoveryRate}%.` : 'Collection baseline being established.',
      ];

  const workspaceStatus = totalCount === 0 ? 'READY' : watching ? 'WORKING' : agentStatus.toUpperCase();

  const timelineHeading = watching
    ? 'AI is working through the collection cycle...'
    : cycleResult
    ? cycleResult.invoicesEvaluated === 0
      ? 'No overdue invoices found — nothing to process'
      : `Last cycle: ${cycleResult.invoicesEvaluated} invoice${cycleResult.invoicesEvaluated !== 1 ? 's' : ''} evaluated`
    : 'How every invoice recovery works';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

      {/* ─── Morning Brief ─── */}
      <div className="os-card" style={{
        background: 'var(--yellow)',
        border: 'var(--stroke)',
        padding: '28px 32px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ maxWidth: '700px' }}>
            <div className="label-text" style={{ color: 'var(--ink)', opacity: 0.6, marginBottom: '12px' }}>
              DAILY BRIEFING
            </div>
            <div style={{
              fontSize: '1.2rem',
              fontWeight: 500,
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.65,
              color: 'var(--ink)',
              minHeight: '140px'
            }}>
              <Typewriter lines={briefLines} speed={25} delay={300} />
            </div>
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            color: 'var(--ink)',
            opacity: 0.5,
            textAlign: 'right',
            flexShrink: 0
          }}>
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
            <br />
            STATUS: {workspaceStatus}
          </div>
        </div>
      </div>

      {/* ─── Main Grid: Mission + Timeline ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px', alignItems: 'start' }}>

        {/* Left: Today's Mission + Metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Mission Card */}
          <div className="os-card" style={{ padding: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <div className="label-text">TODAY'S MISSION</div>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-hero)',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  marginTop: '4px'
                }}>
                  {outstanding > 0 ? `Recover ₹${outstanding.toLocaleString('en-IN')}` : 'No collections pending'}
                </div>
              </div>
              <button
                className="primary"
                onClick={handleWatchLive}
                disabled={agentState === 'processing'}
                data-tour-id="tour-watch-ai"
                style={{
                  flexShrink: 0,
                  minWidth: '180px',
                  height: '42px',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {agentState === 'processing' ? '● Watching...' :
                 agentState === 'completed' ? '✓ AI Work Complete' :
                 agentState === 'error' ? 'Retry AI Work' :
                 '▶ Watch AI Work'}
              </button>
            </div>

            {/* Progress bar */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-label)',
                color: 'var(--muted)',
                marginBottom: '6px'
              }}>
                <span>Recovery progress</span>
                <span>{recovered + outstanding > 0 ? Math.round((recovered / (recovered + outstanding)) * 100) : 0}%</span>
              </div>
              <div style={{
                height: '6px',
                background: 'var(--border)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: 'var(--yellow)',
                  borderRadius: '3px',
                  width: `${recovered + outstanding > 0 ? Math.round((recovered / (recovered + outstanding)) * 100) : 0}%`,
                  transition: 'width 1s var(--ease-out)'
                }} />
              </div>
            </div>

            {/* Quick stats — all from real data */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '12px'
            }}>
              {[
                { label: 'Active Invoices', value: openCount },
                { label: 'Messages Sent', value: messagesSent },
                { label: 'Hours Saved', value: hoursSaved },
                { label: 'Collection Rate', value: `${recoveryRate}%` },
              ].map((s, i) => (
                <div key={i} style={{
                  padding: '12px',
                  background: 'var(--paper-warm)',
                  borderRadius: '3px'
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)', color: 'var(--muted)' }}>
                    {s.label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--text-title)',
                    fontWeight: 700,
                    marginTop: '4px'
                  }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Metrics Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="os-card" style={{ padding: '20px' }}>
              <div className="label-text">RECOVERED</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-metrics)', fontWeight: 800 }}>
                <AnimCounter value={recovered} prefix="₹" />
              </div>
            </div>
            <div className="os-card" style={{ padding: '20px' }}>
              <div className="label-text">BUSINESS HEALTH</div>
              {totalCount === 0 ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption)', color: 'var(--muted)', marginTop: '8px' }}>
                  Add invoices to measure
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-metrics)', fontWeight: 800 }}>
                    {computedHealthScore}%
                  </span>
                  <span className={`badge badge-${computedHealthScore >= 80 ? 'paid' : computedHealthScore >= 50 ? 'warning' : 'escalated'}`}>
                    {computedHealthScore >= 80 ? 'Excellent' : computedHealthScore >= 50 ? 'Healthy' : 'Needs Nudge'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Recent Invoices */}
          <div className="os-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>Active Collections</h3>
              <Link to="/collections" style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-label)',
                color: 'var(--muted)',
                textDecoration: 'none'
              }}>
                View all →
              </Link>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {invoices.slice(0, 4).map((inv) => {
                const isHighlighted = highlightedInvoiceId === inv.invoice_id;
                return (
                  <div key={inv.id}
                    data-invoice-id={inv.invoice_id}
                    data-client-name={inv.client_name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                      background: isHighlighted ? 'rgba(255, 212, 0, 0.15)' : 'var(--paper-warm)',
                      borderRadius: '3px',
                      transition: 'all 0.4s ease',
                      border: isHighlighted ? '1.5px solid var(--yellow)' : '1.5px solid transparent',
                      boxShadow: isHighlighted ? '0 0 16px rgba(255, 212, 0, 0.3)' : 'none',
                      transform: isHighlighted ? 'scale(1.02)' : 'scale(1)'
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-body)' }}>{inv.client_name}</div>
                      <div style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', marginTop: '2px' }}>
                        {inv.invoice_id} · ₹{inv.amount.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <span className={`badge badge-${inv.status === 'paid' ? 'paid' : inv.status === 'escalated' ? 'escalated' : 'open'}`}>
                      {inv.status}
                    </span>
                  </div>
                );
              })}
              {invoices.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--text-caption)' }}>
                  No active collections. <Link to="/add" style={{ color: 'var(--ink)', fontWeight: 600 }}>Create your first invoice</Link> to begin.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: AI Decision Timeline + Autonomous Insights */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* AI Decision Timeline — live from SSE */}
          <div className="os-card" style={{ padding: '24px' }}>
            <h3 className="section-title">AI Decision Flow</h3>
            <p style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', marginBottom: '16px', marginTop: '-8px', fontFamily: 'var(--font-mono)', minHeight: '2.5em' }}>
              {timelineHeading}
            </p>
            <AITimeline stages={liveStages} isActive={watching} />
            {/* Empty state: cycle ran but found nothing to process */}
            {!watching && cycleResult && cycleResult.invoicesEvaluated === 0 && (
              <div style={{
                marginTop: '16px', padding: '14px 16px',
                background: 'var(--paper-warm)', borderRadius: '3px',
                border: 'var(--stroke-subtle)',
                fontSize: 'var(--text-caption)', color: 'var(--muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                ℹ No overdue invoices in your workspace right now. Create an invoice and set a past due date to see the AI collection cycle in action.
              </div>
            )}
          </div>

          {/* Autonomous Insights — computed from real data */}
          <div className="os-card" style={{ background: 'var(--paper-warm)' }}>
            <h3 className="section-title">AI Observations</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {totalCount === 0 ? (
                <div style={{ fontSize: 'var(--text-caption)', color: 'var(--muted)' }}>
                  No observations yet. Add your first invoice to initialize AI monitoring.
                </div>
              ) : (
                [
                  `Monitoring ${openCount} active receivable${openCount !== 1 ? 's' : ''} with autonomous cycles.`,
                  recovered > 0
                    ? `Successfully recovered ₹${recovered.toLocaleString('en-IN')} across contracts.`
                    : 'Awaiting first contract settlement.',
                  recoveryRate > 0
                    ? `Workspace recovery rate is currently at ${recoveryRate}%.`
                    : 'Establishing baseline collection success ratios.',
                  overdueCount > 0
                    ? `${overdueCount} invoice${overdueCount !== 1 ? 's are' : ' is'} currently overdue and tracked.`
                    : 'All active accounts are running within healthy terms.'
                ].map((insight, i) => (
                  <div key={i} style={{
                    fontSize: 'var(--text-caption)',
                    lineHeight: 1.5,
                    padding: '8px 0',
                    borderBottom: i < 3 ? 'var(--stroke-subtle)' : 'none',
                    color: 'var(--ink)'
                  }}>
                    💡 {insight}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
