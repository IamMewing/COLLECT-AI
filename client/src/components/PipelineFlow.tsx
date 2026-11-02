import React, { useMemo } from 'react';
import type { SweepResult, ApproveResult, ApiError } from '../types';
import { RefreshCw } from 'lucide-react';

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

/** Mirrors the real strands Graph in agent/graph.py: risk and probability are
 *  parallel entry points, they fan into plan, plan conditionally reaches draft,
 *  and reflection runs after the human decides. */
const NODES: NodeDef[] = [
  { id: 'risk',        name: 'Score the risk',  sub: 'how much is at stake' },
  { id: 'probability', name: 'Predict payment', sub: 'will they pay anyway' },
  { id: 'plan',        name: 'Decide',          sub: 'chase, or leave it' },
  { id: 'draft',       name: 'Write it',        sub: 'tone matched to history' },
  { id: 'reflect',     name: 'Learn',           sub: 'after your decision' },
  // x sits each node directly above its own readout column below.
].map((n, i) => ({ ...n, x: [10, 30, 50, 70, 90][i] }));

const ACID = '#FFE500';
const MINT = '#00B85F';
const BLOOD = '#FF2D1F';
const DIM = 'rgba(255,229,0,0.26)';
const MUTED = 'rgba(255,229,0,0.5)';

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
    if (status === 'error') return BLOOD;
    if (status === 'active') return ACID;
    if (status === 'skipped') return MUTED;
    if (status === 'done' && sweepResult) {
      if (nodeId === 'risk') {
        if (sweepResult.risk.category === 'Critical' || sweepResult.risk.category === 'High') return BLOOD;
        return MINT;
      }
      if (nodeId === 'probability') {
        return sweepResult.probability.probability < 50 ? BLOOD : MINT;
      }
      if (nodeId === 'plan') {
        return sweepResult.risk.category === 'Critical' || sweepResult.risk.category === 'High' ? BLOOD : MINT;
      }
      if (nodeId === 'draft' && sweepResult.plan.tone === 'urgent') return BLOOD;
      return MINT;
    }
    return DIM;
  };

  /** Each node reports its own finding once it has one. */
  const readingFor = (id: string, status: NodeStatus): string => {
    if (status === 'error') return 'Failed';
    if (id === 'risk' && status === 'done' && sweepResult) return `${sweepResult.risk.category}, ${sweepResult.risk.score}/100`;
    if (id === 'probability' && status === 'done' && sweepResult) return `${sweepResult.probability.probability}% likely to pay`;
    if (id === 'plan' && status === 'done' && sweepResult) {
      return sweepResult.plan.branch === 'no_action' ? 'Leave it alone' : `Chase by ${sweepResult.plan.channel}`;
    }
    if (id === 'draft') {
      if (status === 'skipped') return 'Nothing sent';
      if (status === 'done' && sweepResult?.draft) {
        const tone = sweepResult.plan.tone;
        return `${tone.charAt(0).toUpperCase()}${tone.slice(1)} ${sweepResult.draft.channel}`;
      }
    }
    if (id === 'reflect') {
      if (status === 'done') return 'Saved to memory';
      if (status === 'skipped') return 'No lesson logged';
    }
    if (status === 'active') return 'Working…';
    return NODES.find((n) => n.id === id)?.sub ?? 'Waiting';
  };

  const edgePairs: [string, string][] = [['risk', 'plan'], ['probability', 'plan'], ['plan', 'draft'], ['draft', 'reflect']];
  const nodeX = (id: string) => NODES.find((n) => n.id === id)!.x;
  // Risk and probability are parallel entry points, so they share the top row
  // and fan down into plan.
  const nodeY = (id: string) => (id === 'risk' || id === 'probability' ? 6 : 19);

  const edgeState = (_from: string, to: string): 'live' | 'done' | 'skipped' | 'idle' => {
    const sTo = statuses[to];
    if (to === 'draft' && statuses.plan === 'done' && sweepResult?.plan.branch === 'no_action') return 'skipped';
    if (sTo === 'active') return 'live';
    if (sTo === 'done') return 'done';
    if (sTo === 'skipped') return 'skipped';
    return 'idle';
  };

  if (error) {
    return (
      <div className="slab" style={{ borderColor: BLOOD, color: BLOOD }}>
        <h3 className="title" style={{ marginBottom: 10 }}>The agent didn’t answer</h3>
        <p className="body" style={{ color: ACID, opacity: 0.8, marginBottom: 20 }}>
          {error.details || error.error || 'The reasoning engine timed out. Free-tier rate limits do this.'}
        </p>
        {onRetry && (
          <button className="pill" onClick={onRetry} style={{ ['--pill-fg' as string]: BLOOD, ['--pill-inv' as string]: '#fff' }}>
            <RefreshCw size={14} /> Try again
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <svg
        viewBox="0 0 100 26"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        aria-label="Agent reasoning graph"
      >
        {edgePairs.map(([from, to]) => {
          const state = edgeState(from, to);
          const x1 = nodeX(from), y1 = nodeY(from), x2 = nodeX(to), y2 = nodeY(to);
          const stroke = state === 'live' ? ACID : state === 'done' ? MINT : state === 'skipped' ? MUTED : DIM;
          return (
            <g key={`${from}-${to}`}>
              <line
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={stroke}
                strokeWidth={state === 'idle' ? 0.22 : 0.4}
                strokeDasharray={state === 'skipped' ? '1.2 1.2' : undefined}
              />
              {state === 'live' && (
                <circle r="0.8" fill={ACID}>
                  <animateMotion dur="1.05s" repeatCount="indefinite" path={`M ${x1} ${y1} L ${x2} ${y2}`} />
                </circle>
              )}
            </g>
          );
        })}

        {NODES.map((n) => {
          const status = statuses[n.id];
          const color = colorFor(status, n.id);
          const y = nodeY(n.id);
          const active = status === 'active';
          return (
            <g key={n.id} transform={`translate(${n.x}, ${y})`}>
              {active && <circle r="1.8" fill="none" stroke={color} strokeWidth="0.3" className="pf-ring" />}
              <circle r="1.35" fill={status === 'idle' ? 'none' : color} stroke={color} strokeWidth="0.4" />
            </g>
          );
        })}
      </svg>

      <div className="readouts" style={{ marginTop: 'clamp(20px, 3vw, 34px)' }}>
        {NODES.map((n) => {
          const status = statuses[n.id];
          const color = colorFor(status, n.id);
          return (
            <div className="readout" key={n.id}>
              <dt style={{ opacity: 1, color: status === 'idle' ? MUTED : color }}>
                {status === 'active' && <span className="dot dot--live" style={{ display: 'inline-block', marginRight: 7 }} />}
                {n.name}
              </dt>
              <dd
                style={{
                  fontFamily: 'var(--display)',
                  fontWeight: 600,
                  letterSpacing: '-0.015em',
                  fontSize: 'clamp(0.85rem, 1.15vw, 1.02rem)',
                  lineHeight: 1.28,
                  color: status === 'idle' ? MUTED : color,
                }}
              >
                {readingFor(n.id, status)}
              </dd>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PipelineFlow;
