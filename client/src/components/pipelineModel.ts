import type { SweepResult, ApproveResult, ApiError } from '../types';

/**
 * The agent's graph, and the rule for what each step is doing right now.
 *
 * Two things draw this: the full panel in the agent section, and the floating
 * rail that follows you down the page once that section is behind you. They
 * have to agree — a rail that says "thinking" while the panel says "done" is
 * worse than no rail — so the step list and the status rule live here rather
 * than in either component.
 */

export type NodeStatus = 'idle' | 'active' | 'done' | 'skipped' | 'error';

export interface NodeDef {
  id: string;
  name: string;
  /** What the step does, shown until it has a finding of its own to report. */
  sub: string;
  /** Position in the full panel. The rail ignores these. */
  x: number;
  y: number;
}

/** Rows and the baseline the whole panel is measured against. */
export const TOP_ROW = 5;
export const BOTTOM_ROW = 20;
export const BASE = 24.4;

/** Mirrors the real strands Graph in agent/graph.py: risk and probability are
 *  parallel entry points, they fan into plan, plan conditionally reaches draft,
 *  and reflection runs after the human decides.
 *  x sits each node directly above its own readout column below. */
export const NODES: NodeDef[] = [
  { id: 'risk',        name: 'Score the risk',  sub: 'how much is at stake',    x: 10, y: TOP_ROW },
  { id: 'probability', name: 'Predict payment', sub: 'will they pay anyway',    x: 30, y: TOP_ROW },
  { id: 'plan',        name: 'Decide',          sub: 'chase, or leave it',      x: 50, y: BOTTOM_ROW },
  { id: 'draft',       name: 'Write it',        sub: 'tone matched to history', x: 70, y: BOTTOM_ROW },
  { id: 'reflect',     name: 'Learn',           sub: 'after your decision',     x: 90, y: BOTTOM_ROW },
];

export const EDGES: [string, string][] = [
  ['risk', 'plan'],
  ['probability', 'plan'],
  ['plan', 'draft'],
  ['draft', 'reflect'],
];

export interface RunState {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
  error: ApiError | null;
}

/** The single source of truth for what every step is doing. */
export const computeStatuses = ({
  sweepResult, approveResult, isSweeping, isApproving, error,
}: RunState): Record<string, NodeStatus> => {
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
};

/** One line describing the run as a whole, for the rail's caption. */
export const runCaption = (s: RunState): string => {
  if (s.error) return 'Agent stalled';
  if (s.isSweeping) return 'Thinking…';
  if (s.isApproving) return 'Recording…';
  if (!s.sweepResult) return 'Agent idle';
  if (s.sweepResult.plan.branch === 'no_action') return 'Left alone';
  if (s.approveResult) return s.approveResult.status === 'skipped' ? 'Not sent' : 'Sent';
  return 'Draft ready';
};
