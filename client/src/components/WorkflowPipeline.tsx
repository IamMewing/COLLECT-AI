import React from 'react';
import type { SweepResult, ApproveResult } from '../types';

interface WorkflowPipelineProps {
  sweepResult: SweepResult | null;
  approveResult: ApproveResult | null;
  isSweeping: boolean;
  isApproving: boolean;
}

export const WorkflowPipeline: React.FC<WorkflowPipelineProps> = ({
  sweepResult,
  approveResult,
  isSweeping,
  isApproving,
}) => {
  const steps = [
    {
      title: 'Risk Assessment',
      sub: sweepResult ? `${sweepResult.risk.category} (${sweepResult.risk.score}/100)` : 'Parallel Node 1',
    },
    {
      title: 'Payment Probability',
      sub: sweepResult ? `${sweepResult.probability.probability}% Chance` : 'Parallel Node 2',
    },
    {
      title: 'Action Strategy',
      sub: sweepResult ? `Branch: ${sweepResult.plan.branch}` : 'Fan-in Node',
    },
    {
      title: 'Tone & Draft',
      sub: sweepResult
        ? sweepResult.draft
          ? `${sweepResult.plan.channel.toUpperCase()} (${sweepResult.plan.tone})`
          : 'No Draft (No Action)'
        : 'Conditional Edge',
    },
    {
      title: 'Approval Gate',
      sub: approveResult
        ? approveResult.status === 'skipped'
          ? 'Rejected by Reviewer'
          : 'Approved by Reviewer'
        : sweepResult?.draft
        ? 'Awaiting Decision'
        : 'Standby',
    },
    {
      title: 'Reflection Feedback',
      sub: approveResult?.reflection
        ? `Tone Shift: ${approveResult.reflection.suggested_tone_shift.substring(0, 18)}...`
        : approveResult
        ? 'Cycle Closed'
        : 'Post-Execution',
    },
  ];

  // Determine stage active/completed state
  let currentStage = 0;
  if (isSweeping) {
    currentStage = 1;
  } else if (sweepResult) {
    if (approveResult) {
      currentStage = 6;
    } else if (isApproving) {
      currentStage = 5;
    } else if (sweepResult.draft) {
      currentStage = 4;
    } else {
      currentStage = 3; // Finished at plan because branch == no_action
    }
  }

  return (
    <div
      className="os-card os-card-warm"
      style={{
        padding: '16px 20px',
        border: 'var(--stroke)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <span className="label-text">Strands Multi-Agent Graph Pipeline</span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            color: 'var(--muted)',
          }}
        >
          {isSweeping
            ? 'Running graph...'
            : isApproving
            ? 'Executing decision...'
            : approveResult
            ? 'Workflow complete'
            : sweepResult
            ? 'Waiting for human gate'
            : 'Ready to sweep'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '10px',
        }}
      >
        {steps.map((step, idx) => {
          const isCompleted = idx < currentStage;
          const isActive = idx === currentStage;

          let bg = 'var(--white)';
          let borderColor = 'var(--border)';
          let statusLabel = 'PENDING';

          if (isCompleted) {
            bg = 'var(--mint)';
            borderColor = 'var(--ink)';
            statusLabel = 'DONE';
          } else if (isActive) {
            bg = 'var(--yellow)';
            borderColor = 'var(--ink)';
            statusLabel = 'ACTIVE';
          }

          return (
            <div
              key={idx}
              style={{
                backgroundColor: bg,
                border: `2px solid ${borderColor}`,
                borderRadius: '3px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                boxShadow: isActive || isCompleted ? '2px 2px 0 var(--ink)' : 'none',
                opacity: isCompleted || isActive ? 1 : 0.65,
                transition: 'all 0.2s ease',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: 'var(--muted)',
                }}
              >
                <span>STAGE 0{idx + 1}</span>
                <span style={{ color: isActive ? 'var(--ink)' : undefined }}>{statusLabel}</span>
              </div>

              <span
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-display)',
                  lineHeight: '1.2',
                  marginTop: '2px',
                }}
              >
                {step.title}
              </span>

              <span
                style={{
                  fontSize: '0.68rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ink)',
                  opacity: 0.85,
                  marginTop: 'auto',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={step.sub}
              >
                {step.sub}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
