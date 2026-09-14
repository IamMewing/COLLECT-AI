import React, { useMemo } from 'react';
import type { SweepResult, ApproveResult, ApiError } from '../types';
import { Zap, AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';

interface PipelineFlowProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
  error: ApiError | null;
  onRetry?: () => void;
}

type NodeStatus = 'idle' | 'active' | 'done' | 'skipped' | 'error';

interface NodeDef { id: string; name: string; sub: string; x: number; }

const NODES: NodeDef[] = [
  { id: 'risk',        name: 'Risk Assess',   sub: 'calculate_risk_score' },
  { id: 'probability',  name: 'Probability',   sub: 'predict_payment_probability' },
  { id: 'plan',         name: 'Plan Strategy', sub: 'fan-in · conditional' },
  { id: 'draft',        name: 'Draft Message', sub: 'tone-matched outreach' },
  { id: 'reflect',      name: 'Reflection',    sub: 'phase 2 · post-gate' },
].map((n, i) => ({ ...n, x: [10, 10, 38, 66, 90][i] }));

/** Pure 2D, SVG + CSS animated pipeline — no WebGL, reliable 60fps, and a true
 *  visualization of the real strands multiagent Graph topology + live state. */
export const PipelineFlow: React.FC<PipelineFlowProps> = ({
  sweepResult, approveResult, isSweeping, isApproving, error, onRetry,
}) => {
  const statuses = useMemo<Record<string, NodeStatus>>(() => {
    if (error) return { risk: 'error', probability: 'error', plan: 'idle', draft: 'idle', reflect: 'idle' };
    if (isSweeping) return { risk: 'active', probability: 'active', plan: 'idle', draft: 'idle', reflect: 'idle' };
    if (!sweepResult) return { risk: 'idle', probability: 'idle', plan: 'idle', draft: 'idle', reflect: 'idle' };

    const noAction = sweepResult.plan.branch === 'no_action';
    const draftStatus: NodeStatus = noAction ? 'skipped' : 'done';
    let reflectStatus: NodeStatus = 'idle';
    if (!noAction) {
      if (isApproving) reflectStatus = 'active';
      else if (approveResult) reflectStatus = approveResult.status === 'skipped' ? 'skipped' : 'done';
    }
    return { risk: 'done', probability: 'done', plan: 'done', draft: draftStatus, reflect: reflectStatus };
  }, [sweepResult, approveResult, isSweeping, isApproving, error]);

  const colorFor = (status: NodeStatus, nodeId: string): string => {
    if (status === 'error') return 'var(--critical)';
    if (status === 'active') return 'var(--gold)';
    if (status === 'skipped') return 'var(--text-muted)';
    if (status === 'done') {
      if (nodeId === 'plan' && sweepResult) {
        return sweepResult.risk.category === 'Critical' || sweepResult.risk.category === 'High'
          ? 'var(--critical)' : 'var(--healthy)';
      }
      if (nodeId === 'draft' && sweepResult?.plan.tone === 'urgent') return 'var(--critical)';
      return 'var(--healthy)';
    }
    return 'var(--border-active)';
  };

  const subtitleFor = (id: string, status: NodeStatus): string => {
    if (status === 'error') return 'ERROR';
    if (id === 'risk' && status === 'done' && sweepResult) return `${sweepResult.risk.category.toUpperCase()} (${sweepResult.risk.score}/100)`;
    if (id === 'probability' && status === 'done' && sweepResult) return `${sweepResult.probability.probability}% LIKELY`;
    if (id === 'plan' && status === 'done' && sweepResult) return `BRANCH: ${sweepResult.plan.branch.toUpperCase()}`;
    if (id === 'draft') {
      if (status === 'skipped') return 'NO ACTION — SUPPRESSED';
      if (status === 'done' && sweepResult?.draft) return `${sweepResult.draft.channel.toUpperCase()} · ${sweepResult.plan.tone.toUpperCase()}`;
    }
    if (id === 'reflect') {
      if (status === 'done') return 'LOGGED TO MEMORY';
      if (status === 'skipped') return 'REJECTED — NO REFLECTION';
    }
    if (status === 'active') return 'PROCESSING…';
    return NODES.find(n => n.id === id)?.sub.toUpperCase() || 'STANDBY';
  };

  const edgePairs: [string, string][] = [['risk', 'plan'], ['probability', 'plan'], ['plan', 'draft'], ['draft', 'reflect']];
  const nodeX = (id: string) => NODES.find(n => n.id === id)!.x;
  const nodeY = (id: string) => (id === 'risk' ? 28 : id === 'probability' ? 72 : 50);

  const edgeState = (from: string, to: string): 'live' | 'done' | 'skipped' | 'idle' => {
    const sTo = statuses[to];
    if (to === 'draft' && statuses.plan === 'done' && sweepResult?.plan.branch === 'no_action') return 'skipped';
    if (sTo === 'active') return 'live';
    if (sTo === 'done') return 'done';
    if (sTo === 'skipped') return 'skipped';
    return 'idle';
  };

  return (
    <section className="ledger-panel reveal d1" style={{ padding: '26px 28px 30px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="mono-label" style={{ fontSize: '0.72rem' }}>STRANDS MULTI-AGENT GRAPH TOPOLOGY</span>
            <span className={`badge ${error ? 'badge-critical' : isSweeping ? 'badge-gold' : 'badge-healthy'}`}>
              {error ? <AlertTriangle size={11} /> : <Zap size={11} />}
              {error ? 'FAULT' : isSweeping ? 'LIVE REASONING PULSE' : sweepResult ? 'SWEEP COMPILED' : 'TOPOLOGY READY'}
            </span>
          </div>
          <div className="mono-value" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>
            graph.py: Parallel Entry (Risk + Probability) → Plan Strategy → Conditional Edge → Draft → Reflect
          </div>
        </div>
      </div>

      {error ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 14, padding: '52px 20px', borderRadius: 12,
          background: 'rgba(255,59,107,0.05)', border: '1px solid rgba(255,59,107,0.25)',
        }}>
          <ShieldAlert size={30} color="var(--critical)" />
          <div style={{ textAlign: 'center' }}>
            <div className="display-title" style={{ fontSize: '1.05rem', color: 'var(--critical)' }}>Agent Temporarily Unavailable</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 6, maxWidth: 440 }}>
              {error.details || error.error || 'The reasoning engine did not respond in time. This can happen on free-tier rate limits.'}
            </div>
          </div>
          {onRetry && (
            <button className="btn btn-neutral" onClick={onRetry} style={{ marginTop: 4 }}>
              <RefreshCw size={14} /> Retry Sweep
            </button>
          )}
        </div>
      ) : (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'clamp(260px, 34vw, 380px)' }}>
          <defs>
            <filter id="pf-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* edges */}
          {edgePairs.map(([from, to]) => {
            const state = edgeState(from, to);
            const x1 = nodeX(from), y1 = nodeY(from), x2 = nodeX(to), y2 = nodeY(to);
            const stroke = state === 'live' ? 'var(--gold)' : state === 'done' ? 'var(--healthy)' : state === 'skipped' ? 'var(--text-muted)' : 'var(--border-subtle)';
            return (
              <g key={`${from}-${to}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke}
                  strokeWidth={state === 'idle' ? 0.35 : 0.6}
                  strokeDasharray={state === 'skipped' ? '2 2' : undefined}
                  opacity={state === 'idle' ? 0.35 : 0.85} />
                {state === 'live' && (
                  <circle r="1.1" fill="var(--gold)" filter="url(#pf-glow)">
                    <animateMotion dur="1.1s" repeatCount="indefinite"
                      path={`M ${x1} ${y1} L ${x2} ${y2}`} />
                  </circle>
                )}
              </g>
            );
          })}

          {/* nodes */}
          {NODES.map((n) => {
            const status = statuses[n.id];
            const color = colorFor(status, n.id);
            const y = nodeY(n.id);
            const active = status === 'active';
            return (
              <g key={n.id} transform={`translate(${n.x}, ${y})`}>
                <circle r={active ? 3.6 : 3} fill="none" stroke={color} strokeWidth="0.5"
                  opacity={status === 'idle' ? 0.4 : 0.9} filter={status !== 'idle' ? 'url(#pf-glow)' : undefined}
                  className={active ? 'pf-pulse-ring' : undefined} />
                <circle r={active ? 2.1 : 1.7} fill={color} opacity={status === 'idle' ? 0.5 : 1}
                  className={active ? 'pf-node-breathe' : undefined} />
              </g>
            );
          })}
        </svg>
      )}

      {!error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 8 }}>
          {NODES.map((n) => {
            const status = statuses[n.id];
            const color = colorFor(status, n.id);
            return (
              <div key={n.id} style={{
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${status === 'idle' ? 'var(--border-subtle)' : color}`,
                background: status === 'idle' ? 'rgba(11,15,25,0.4)' : `${color}14`,
                transition: 'all 0.3s ease',
              }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem', color: status === 'idle' ? 'var(--text-secondary)' : color }}>
                  {n.name}
                </div>
                <div className="mono-value" style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: 3, letterSpacing: '0.04em' }}>
                  {subtitleFor(n.id, status)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default PipelineFlow;
