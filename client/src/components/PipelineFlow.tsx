import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SweepResult, ApproveResult, ApiError } from '../types';
import { RefreshCw, ChevronDown } from 'lucide-react';
import { useInView } from '../useInView';
import type { NodeStatus } from './pipelineModel';
import { NODES, EDGES, BASE, computeStatuses } from './pipelineModel';

interface PipelineFlowProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
  error: ApiError | null;
  onRetry?: () => void;
}

const MINT = '#2BE38A';
const CORAL = '#FF6B4D';
const DIM = 'rgba(43,227,138,0.32)';
const MUTED = 'rgba(43,227,138,0.5)';

/**
 * An orb's colour says what the STEP is doing, never what it found.
 *
 * This used to tint each orb by the severity of its own reading — a critical
 * risk score painted the orb red — so a step that ran perfectly and reported
 * bad news looked like a step that had failed. On a graph of a process, red
 * and green mean broken and working; they cannot also mean expensive and
 * cheap. The findings carry their own severity in the readout text, which is
 * where a number being alarming belongs.
 */
const stateColor = (status: NodeStatus): string => {
  if (status === 'error') return CORAL;
  if (status === 'idle') return DIM;
  if (status === 'skipped') return MUTED;
  return MINT; // working and settled are both the live colour
};

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

  const statuses = useMemo<Record<string, NodeStatus>>(
    () => computeStatuses({ sweepResult, approveResult, isSweeping, isApproving, error }),
    [sweepResult, approveResult, isSweeping, isApproving, error]
  );

  const colorFor = (status: NodeStatus) => stateColor(status);

  /** Severity of a reading lives in the readout text, where "this number is
   *  alarming" is the right thing to say — and never on the orb, where it
   *  would read as "this step went wrong". */
  const alarming = (id: string): boolean => {
    if (!sweepResult) return false;
    const hot = sweepResult.risk.category === 'Critical' || sweepResult.risk.category === 'High';
    if (id === 'risk') return hot;
    if (id === 'probability') return sweepResult.probability.probability < 50;
    if (id === 'plan') return sweepResult.plan.branch === 'escalation';
    if (id === 'draft') return sweepResult.plan.tone === 'urgent';
    return false;
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
      const { branch, channel } = sweepResult.plan;
      if (branch === 'no_action') return 'Leave it alone';
      // Escalation isn't a louder version of the same sentence — it's a
      // different decision (this account has been chased before and ignored),
      // so it gets its own verb rather than hiding inside "chase".
      return branch === 'escalation' ? `Escalate via ${channel}` : `Chase by ${channel}`;
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

  /** The sentence behind a score, when the step has one. This is the actual
   *  model output — RiskAssessment.reasoning, ProbabilityAssessment.explanation,
   *  ActionPlan.reasoning all come straight through from agent/models.py — not
   *  a paraphrase written here. Reflection has no single "reasoning" field, so
   *  its three structured judgments are composed into one. A node with nothing
   *  to show (draft, or anything not finished yet) returns null and gets no
   *  disclosure control at all, rather than an empty one. */
  const reasonFor = (id: string): string | null => {
    if (id === 'risk' && sweepResult) return sweepResult.risk.reasoning;
    if (id === 'probability' && sweepResult) return sweepResult.probability.explanation;
    if (id === 'plan' && sweepResult) return sweepResult.plan.reasoning;
    if (id === 'reflect' && approveResult?.reflection) {
      const r = approveResult.reflection;
      const delta = r.suggested_relationship_delta;
      const dir = delta > 0 ? `raise standing by ${delta}` : delta < 0 ? `lower standing by ${Math.abs(delta)}` : 'leave standing unchanged';
      return `${r.was_best_decision ? 'Judged the right call.' : 'Flagged for review — a different move might have landed better.'} Next time: ${r.suggested_tone_shift.toLowerCase()}. Memory update: ${dir}.`;
    }
    return null;
  };

  const [revealed, setRevealed] = useState<string | null>(null);
  // A node finishing with its text already open (e.g. risk re-settling after a
  // retry) shouldn't leave the panel pointed at a node that no longer has
  // anything to say.
  useEffect(() => {
    if (revealed && reasonFor(revealed) === null) setRevealed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweepResult, approveResult]);

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
      <div className="slab" style={{ borderColor: CORAL, color: CORAL }}>
        <h3 className="title" style={{ marginBottom: 10 }}>The agent didn’t answer</h3>
        <p className="body" style={{ color: MINT, opacity: 0.8, marginBottom: 20 }}>
          {error.details || error.error || 'The reasoning engine timed out. Free-tier rate limits do this.'}
        </p>
        {onRetry && (
          <button className="pill" onClick={onRetry} style={{ ['--pill-fg' as string]: CORAL, ['--pill-inv' as string]: '#000' }}>
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
          <line x1="0" y1="1.5" x2="0" y2={BASE} stroke={MINT} strokeWidth="0.13" opacity="0.5" />
          <line x1="-1.1" y1="3" x2="-1.1" y2={BASE} stroke={MINT} strokeWidth="0.09" opacity="0.22" />
          <line x1="-2.4" y1="5" x2="-2.4" y2={BASE} stroke={MINT} strokeWidth="0.07" opacity="0.1" />
        </g>

        {EDGES.map(([from, to], i) => {
          const state = edgeState(from, to);
          const stroke = state === 'live' || state === 'done' ? MINT : state === 'skipped' ? MUTED : DIM;
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
          const color = colorFor(status);
          const active = status === 'active';
          const done = status === 'done';
          const reason = reasonFor(n.id);
          const open = revealed === n.id;
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              <g
                className={`pf-orb pf-orb--${status}${reason ? ' pf-orb--has-reason' : ''}${open ? ' pf-orb--open' : ''}`}
                style={{ ['--i' as string]: i, color }}
                {...(reason ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-expanded': open,
                  'aria-label': `${n.name} — ${open ? 'hide' : 'show'} the agent's reasoning`,
                  onClick: () => setRevealed(open ? null : n.id),
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRevealed(open ? null : n.id); }
                  },
                } : {})}
              >
                {/* An orb, not a dot: two shells counter-rotating around a
                    core. Waiting, they barely turn and the core is hollow.
                    Thinking, they spin up, the core fills and pulses out.
                    Settled, one shell closes into a solid ring. */}
                <circle className="pf-shell pf-shell--a" r="2.9" pathLength="1" />
                <circle className="pf-shell pf-shell--b" r="2.3" pathLength="1" />

                {active && <circle className="pf-pulse" r="2.0" pathLength="1" />}
                {active && <circle className="pf-pulse pf-pulse--2" r="2.0" pathLength="1" />}

                {(done || status === 'skipped') && (
                  <circle className="pf-seal" r="2.9" pathLength="1" />
                )}

                <circle className="pf-core" r="1.25" />
                {/* A bright inner bead that drifts while the orb is thinking,
                    so the core isn't a dead disc. */}
                {active && <circle className="pf-spark" r="0.42" cx="0" cy="-0.55" />}

                {/* A step with something to say gets a small ring of dots round
                    its core, independent of status colour, so "there is more
                    here" reads as its own signal rather than borrowing done's. */}
                {reason && !active && (
                  <circle className="pf-ask" r="1.85" pathLength="1" />
                )}

                <text
                  className="pf-index"
                  x="0"
                  y="-4.0"
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
          const color = colorFor(status);
          const reason = reasonFor(n.id);
          const open = revealed === n.id;
          return (
            <div className="readout pf-readout" key={n.id} style={{ ['--i' as string]: i }}>
              <dt style={{ opacity: 1, color: status === 'idle' ? MUTED : color }}>
                {status === 'active' && <span className="dot dot--live" style={{ display: 'inline-block', marginRight: 7 }} />}
                {n.name}
              </dt>
              {reason ? (
                <button
                  type="button"
                  className="pf-reveal"
                  onClick={() => setRevealed(open ? null : n.id)}
                  aria-expanded={open}
                  style={{
                    color: status === 'error' ? CORAL : alarming(n.id) && status === 'done' ? CORAL : color,
                  }}
                >
                  <span className="pf-reveal-text">{readingFor(n.id, status)}</span>
                  <ChevronDown size={13} className={`pf-reveal-chev${open ? ' is-open' : ''}`} />
                </button>
              ) : (
                <dd
                  style={{
                    fontFamily: 'var(--display)',
                    fontWeight: 600,
                    letterSpacing: '-0.015em',
                    fontSize: 'clamp(0.85rem, 1.15vw, 1.02rem)',
                    lineHeight: 1.28,
                    color:
                      status === 'idle' ? MUTED
                      : status === 'error' ? CORAL
                      : alarming(n.id) && status === 'done' ? CORAL
                      : color,
                  }}
                >
                  {readingFor(n.id, status)}
                </dd>
              )}
            </div>
          );
        })}
      </div>

      {/* The sentence behind whichever reading is open. One panel, not one per
          column — five simultaneous paragraphs would fight the numbers above
          them for attention, and only one node is ever being asked about. */}
      {revealed && reasonFor(revealed) && (
        <div className="pf-reason" role="note">
          <span className="pf-reason-tag mono">{node(revealed).name.toUpperCase()}</span>
          <p>{reasonFor(revealed)}</p>
        </div>
      )}
    </div>
  );
};

export default PipelineFlow;
