import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SweepResult, ApproveResult, ApiError } from '../types';
import { RefreshCw } from 'lucide-react';
import { useInView } from '../useInView';

interface PipelineFlowProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
  error: ApiError | null;
  onRetry?: () => void;
}

type NodeStatus = 'idle' | 'active' | 'done' | 'skipped' | 'error';

interface NodeDef { id: string; name: string; sub: string; x: number; y: number; }

/** Rows and the baseline the whole panel is measured against. */
const TOP_ROW = 5;
const BOTTOM_ROW = 20;
const BASE = 24.4;

/** Mirrors the real strands Graph in agent/graph.py: risk and probability are
 *  parallel entry points, they fan into plan, plan conditionally reaches draft,
 *  and reflection runs after the human decides.
 *  x sits each node directly above its own readout column below. */
const NODES: NodeDef[] = [
  { id: 'risk',        name: 'Score the risk',  sub: 'how much is at stake',   x: 10, y: TOP_ROW },
  { id: 'probability', name: 'Predict payment', sub: 'will they pay anyway',   x: 30, y: TOP_ROW },
  { id: 'plan',        name: 'Decide',          sub: 'chase, or leave it',     x: 50, y: BOTTOM_ROW },
  { id: 'draft',       name: 'Write it',        sub: 'tone matched to history', x: 70, y: BOTTOM_ROW },
  { id: 'reflect',     name: 'Learn',           sub: 'after your decision',    x: 90, y: BOTTOM_ROW },
];

const EDGES: [string, string][] = [
  ['risk', 'plan'],
  ['probability', 'plan'],
  ['plan', 'draft'],
  ['draft', 'reflect'],
];

const ACID = '#FFE500';
const MINT = '#00B85F';
const BLOOD = '#FF2D1F';
const DIM = 'rgba(255,229,0,0.34)';
const MUTED = 'rgba(255,229,0,0.5)';

const node = (id: string) => NODES.find((n) => n.id === id)!;

/** An eased S between two nodes. Two nodes on the same row give a straight
 *  line out of this, which is what that part of the graph should look like. */
const edgePath = (from: string, to: string) => {
  const a = node(from);
  const b = node(to);
  const dx = (b.x - a.x) * 0.5;
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
};

/** Numbers land by counting, which reads as the agent arriving at them. */
const CountUp: React.FC<{ value: number }> = ({ value }) => {
  const [n, setN] = useState(value);
  useEffect(() => {
    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setN(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 820;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
};

export const PipelineFlow: React.FC<PipelineFlowProps> = ({
  sweepResult, approveResult, isSweeping, isApproving, error, onRetry,
}) => {
  const [viewRef, inView] = useInView<HTMLDivElement>(0.25);

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
      if (nodeId === 'probability') return sweepResult.probability.probability < 50 ? BLOOD : MINT;
      if (nodeId === 'plan') {
        return sweepResult.risk.category === 'Critical' || sweepResult.risk.category === 'High' ? BLOOD : MINT;
      }
      if (nodeId === 'draft' && sweepResult.plan.tone === 'urgent') return BLOOD;
      return MINT;
    }
    return DIM;
  };

  /** Each node reports its own finding once it has one. */
  const readingFor = (id: string, status: NodeStatus): React.ReactNode => {
    if (status === 'error') return 'Failed';
    if (id === 'risk' && status === 'done' && sweepResult) {
      return <>{sweepResult.risk.category}, <CountUp value={sweepResult.risk.score} />/100</>;
    }
    if (id === 'probability' && status === 'done' && sweepResult) {
      return <><CountUp value={sweepResult.probability.probability} />% likely to pay</>;
    }
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
    return node(id).sub;
  };

  const edgeState = (_from: string, to: string): 'live' | 'done' | 'skipped' | 'idle' => {
    const sTo = statuses[to];
    if (to === 'draft' && statuses.plan === 'done' && sweepResult?.plan.branch === 'no_action') return 'skipped';
    if (sTo === 'active') return 'live';
    if (sTo === 'done') return 'done';
    if (sTo === 'skipped') return 'skipped';
    return 'idle';
  };

  /* Once the graph has been seen, the draw-on has happened and must not replay
     when a sweep changes the colours underneath it. */
  const drawnRef = useRef(false);
  if (inView) drawnRef.current = true;
  const drawn = drawnRef.current;

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
    <div ref={viewRef} className={`pf${drawn ? ' pf--in' : ''}`}>
      <svg
        viewBox="0 0 100 26.5"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        aria-label="Agent reasoning graph"
      >
        <defs>
          {EDGES.map(([from, to]) => (
            <path
              key={`${from}-${to}`}
              id={`pf-${from}-${to}`}
              d={edgePath(from, to)}
              fill="none"
              pathLength="1"
            />
          ))}
        </defs>

        {/* Baseline: an axis with a tick under every node, so the graph reads
            as an instrument reporting on columns rather than a loose diagram,
            and each node is visibly tied to the readout beneath it. */}
        <g className="pf-base">
          <line x1="0" y1={BASE} x2="100" y2={BASE} stroke={DIM} strokeWidth="0.12" />
          {NODES.map((n) => (
            <g key={n.id}>
              <line
                x1={n.x} y1={n.y} x2={n.x} y2={BASE}
                stroke={DIM}
                strokeWidth="0.1"
                strokeDasharray="0.4 0.6"
              />
              <line x1={n.x} y1={BASE - 0.6} x2={n.x} y2={BASE + 0.6} stroke={DIM} strokeWidth="0.16" />
            </g>
          ))}
          {Array.from({ length: 21 }, (_, i) => i * 5).map((x) => (
            <line key={x} x1={x} y1={BASE} x2={x} y2={BASE + 0.3} stroke={DIM} strokeWidth="0.07" />
          ))}
        </g>

        {/* A slow sweep across the panel. Nothing on screen should ever be
            completely still, least of all the part claiming to be thinking. */}
        <g className="pf-sweep">
          <line x1="0" y1="1.5" x2="0" y2={BASE} stroke={ACID} strokeWidth="0.13" opacity="0.5" />
          <line x1="-1.1" y1="3" x2="-1.1" y2={BASE} stroke={ACID} strokeWidth="0.09" opacity="0.22" />
          <line x1="-2.4" y1="5" x2="-2.4" y2={BASE} stroke={ACID} strokeWidth="0.07" opacity="0.1" />
        </g>

        {EDGES.map(([from, to], i) => {
          const state = edgeState(from, to);
          const stroke = state === 'live' ? ACID : state === 'done' ? MINT : state === 'skipped' ? MUTED : DIM;
          const flowing = state === 'live' || state === 'done';
          return (
            <g key={`${from}-${to}`}>
              <use
                href={`#pf-${from}-${to}`}
                className={`pf-edge${state === 'idle' ? ' pf-edge--march' : ''}`}
                stroke={stroke}
                strokeWidth={state === 'idle' ? 0.2 : 0.38}
                strokeLinecap="round"
                /* pathLength is normalised to 1, so dashes are fractions. */
                strokeDasharray={state === 'skipped' ? '0.045 0.05' : undefined}
                style={{ ['--i' as string]: i }}
              />
              {/* A couple of beads per edge, offset in time, so the graph reads
                  as carrying something rather than merely being connected. */}
              {flowing && drawn && [0, 1].map((k) => (
                <circle key={k} r={state === 'live' ? 0.72 : 0.46} fill={stroke} opacity={state === 'live' ? 1 : 0.75}>
                  <animateMotion
                    dur={state === 'live' ? '1.15s' : '2.6s'}
                    begin={`${i * 0.18 + k * (state === 'live' ? 0.57 : 1.3)}s`}
                    repeatCount="indefinite"
                  >
                    <mpath href={`#pf-${from}-${to}`} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          );
        })}

        {NODES.map((n, i) => {
          const status = statuses[n.id];
          const color = colorFor(status, n.id);
          const active = status === 'active';
          const done = status === 'done';
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              <g className="pf-node" style={{ ['--i' as string]: i }}>
                {/* Gauge collar: a dashed ring reads as graduations, and it
                    turns, slowly when waiting and hard while working. */}
                <circle
                  className={`pf-collar${active ? ' pf-collar--spin' : ''}`}
                  r="2.45"
                  fill="none"
                  stroke={color}
                  strokeWidth="0.16"
                  strokeDasharray="0.26 0.74"
                  opacity={status === 'idle' ? 0.5 : 0.85}
                />
                {active && <circle r="1.9" fill="none" stroke={color} strokeWidth="0.26" className="pf-ring" />}
                {active && <circle r="1.9" fill="none" stroke={color} strokeWidth="0.26" className="pf-ring pf-ring--2" />}
                {/* A settled node closes a solid arc over the collar — the
                    gauge reading that this step is locked in. */}
                {(done || status === 'skipped') && (
                  <circle
                    className="pf-lock"
                    r="2.45"
                    fill="none"
                    stroke={color}
                    strokeWidth="0.3"
                    pathLength="1"
                    strokeDasharray="1"
                    opacity={status === 'skipped' ? 0.45 : 1}
                  />
                )}
                <circle
                  className={done ? 'pf-dot pf-dot--breathe' : 'pf-dot'}
                  r="1.3"
                  fill={status === 'idle' ? 'none' : color}
                  stroke={color}
                  strokeWidth="0.38"
                />
                <text
                  className="pf-index"
                  x="0"
                  y="-3.5"
                  fill={color}
                  opacity={status === 'idle' ? 0.55 : 0.9}
                >
                  {String(i + 1).padStart(2, '0')}
                </text>
              </g>
            </g>
          );
        })}
      </svg>

      <div className="readouts pf-readouts" style={{ marginTop: 'clamp(20px, 3vw, 34px)' }}>
        {NODES.map((n, i) => {
          const status = statuses[n.id];
          const color = colorFor(status, n.id);
          return (
            <div className="readout pf-readout" key={n.id} style={{ ['--i' as string]: i }}>
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
