import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NODES, computeStatuses, runCaption } from './pipelineModel';
import type { RunState } from './pipelineModel';

/**
 * The agent's state, kept on screen after you have scrolled past the panel
 * that shows it properly.
 *
 *   O-----O-----O-----O-----O
 *
 * The full graph is not a line — risk and probability run in parallel and fan
 * into the plan — but at this size branching would read as noise, so the rail
 * flattens the graph into the order the steps settle in. It is an indicator,
 * not a diagram; the diagram is one click away, which is what it is for.
 */

/** Evenly spaced across the viewBox, inset far enough for the end orbs. */
const VB_W = 100;
const R = 3.4;
const X0 = R + 2.2;
const SPAN = VB_W - X0 * 2;
const xAt = (i: number) => X0 + (SPAN * i) / (NODES.length - 1);
/** Gap between an orb's edge and the segment, so they never touch. */
const GAP = 1.7;

interface PipelineRailProps extends RunState {
  /** Lift clear of the error toast, which shares this corner on a phone. */
  nudged?: boolean;
}

export const PipelineRail: React.FC<PipelineRailProps> = (props) => {
  const { nudged } = props;
  const [past, setPast] = useState(false);
  const reduced = useRef(false);

  const statuses = useMemo(() => computeStatuses(props), [
    props.sweepResult, props.approveResult, props.isSweeping, props.isApproving, props.error,
  ]);
  const caption = runCaption(props);

  useEffect(() => {
    reduced.current =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    const target = document.getElementById('agent');
    if (!target) return;

    // Only once the section is ABOVE the viewport, never while approaching it
    // from the hero — the rail is for getting back, not for getting there.
    const io = new IntersectionObserver(
      ([e]) => setPast(!e.isIntersecting && e.boundingClientRect.bottom < 0),
      { threshold: 0 }
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  const back = () => {
    document.getElementById('agent')?.scrollIntoView({
      behavior: reduced.current ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <button
      type="button"
      className={`prail${past ? ' is-up' : ''}${nudged ? ' is-nudged' : ''}`}
      onClick={back}
      aria-hidden={!past}
      tabIndex={past ? 0 : -1}
      aria-label={`Agent pipeline — ${caption}. Back to the pipeline.`}
      title="Back to the agent pipeline"
    >
      <span className="prail-cap mono">{caption}</span>

      <svg className="prail-track" viewBox={`0 0 ${VB_W} ${R * 2 + 2}`} aria-hidden="true">
        {NODES.slice(0, -1).map((n, i) => {
          const next = NODES[i + 1];
          const s = statuses[next.id];
          const state = s === 'active' ? 'live' : s === 'done' ? 'done' : s === 'skipped' ? 'skipped' : 'idle';
          return (
            <line
              key={`${n.id}-${next.id}`}
              className={`prail-seg prail-seg--${state}`}
              x1={xAt(i) + R + GAP}
              y1={R + 1}
              x2={xAt(i + 1) - R - GAP}
              y2={R + 1}
            />
          );
        })}

        {NODES.map((n, i) => {
          const s = statuses[n.id];
          return (
            <g key={n.id} className={`prail-node prail-node--${s}`} transform={`translate(${xAt(i)}, ${R + 1})`}>
              {s === 'active' && <circle className="prail-ping" r={R} />}
              <circle className="prail-ring" r={R} />
              {(s === 'done' || s === 'active' || s === 'error') && <circle className="prail-fill" r={R - 1.5} />}
            </g>
          );
        })}
      </svg>
    </button>
  );
};

export default PipelineRail;
