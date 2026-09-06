import React from 'react';
import type { Invoice } from '../lib/api';

interface WorkflowVisualizerProps {
  invoice: Invoice;
}

export const WorkflowVisualizer: React.FC<WorkflowVisualizerProps> = ({ invoice }) => {
  const steps = [
    { title: 'Invoice Issued', label: 'Registered' },
    { title: 'AI Analysis', label: 'Risk check' },
    { title: 'Payment History', label: 'Behavioral profile' },
    { title: 'Conversation Audit', label: 'Context check' },
    { title: 'Probability Engine', label: 'Forecast' },
    { title: 'Urgency Matrix', label: 'Score calculated' },
    { title: 'Tone Tuning', label: invoice.escalation_level > 0 ? 'Firm' : 'Polite' },
    { title: 'Channel Select', label: 'Email / SMS' },
    { title: 'Schedule Trigger', label: 'Timeline lock' },
    { title: 'Dispatch Agent', label: invoice.status === 'open' ? 'Awaiting run' : 'Dispatched' },
    { title: 'Awaiting Response', label: invoice.status === 'open' ? 'Standby' : 'Monitoring' },
    { title: 'Outcome Reflection', label: invoice.status === 'paid' ? 'Completed' : 'Standby' }
  ];

  // Map escalation level / status to current stage index (0-11)
  let currentStage = 0;
  if (invoice.status === 'paid') {
    currentStage = 11;
  } else if (invoice.status === 'escalated') {
    currentStage = 10;
  } else if (invoice.escalation_level === 2) {
    currentStage = 9;
  } else if (invoice.escalation_level === 1) {
    currentStage = 7;
  } else if (invoice.status === 'open') {
    currentStage = 5;
  }

  return (
    <div 
      style={{
        padding: '20px',
        backgroundColor: 'var(--paper-warm)',
        border: 'var(--stroke)',
        marginTop: '16px'
      }}
    >
      <h5 
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          color: 'var(--muted)',
          marginBottom: '16px',
          letterSpacing: '0.05em'
        }}
      >
        ACTIVE AI WORKFLOW PIPELINE
      </h5>

      <div 
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '12px'
        }}
      >
        {steps.map((step, idx) => {
          const isCompleted = idx < currentStage;
          const isActive = idx === currentStage;
          
          let color = 'var(--white)';
          let borderColor = 'var(--border)';
          let statusText = 'Pending';
          
          if (isCompleted) {
            color = 'var(--mint)';
            borderColor = 'var(--ink)';
            statusText = 'Done';
          } else if (isActive) {
            color = 'var(--yellow)';
            borderColor = 'var(--ink)';
            statusText = 'Active';
          }

          return (
            <div 
              key={idx}
              style={{
                backgroundColor: color,
                border: `2px solid ${borderColor}`,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                boxShadow: isActive || isCompleted ? '1px 1px 0 var(--ink)' : 'none',
                opacity: isCompleted || isActive ? 1 : 0.6
              }}
            >
              <span 
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: 'var(--muted)'
                }}
              >
                STAGE {String(idx + 1).padStart(2, '0')}
              </span>
              <span 
                style={{
                  fontSize: '0.78rem',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-display)',
                  lineHeight: '1.2'
                }}
              >
                {step.title}
              </span>
              <span 
                style={{
                  fontSize: '0.65rem',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ink)',
                  opacity: 0.8,
                  marginTop: 'auto',
                  textTransform: 'uppercase'
                }}
              >
                {step.label} · {statusText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
