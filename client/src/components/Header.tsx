import React from 'react';
import { Bot, RefreshCw } from 'lucide-react';

interface HeaderProps {
  onRefresh?: () => void;
  isLoading?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onRefresh, isLoading }) => {
  return (
    <header
      style={{
        borderBottom: 'var(--stroke-thick)',
        background: 'var(--white)',
        padding: '16px 28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 2px 0 var(--ink)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '42px',
            height: '42px',
            background: 'var(--yellow)',
            border: 'var(--stroke)',
            boxShadow: 'var(--shadow-flat-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '1.2rem',
            fontFamily: 'var(--font-display)',
          }}
        >
          CA
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.35rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              CollectAI
            </h1>
            <span
              style={{
                background: 'var(--mint)',
                border: '1.5px solid var(--ink)',
                borderRadius: '2px',
                padding: '2px 6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.65rem',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span className="pulsing-dot" /> STRANDS AGENTS GRAPH
            </span>
          </div>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--muted)',
              marginTop: '2px',
            }}
          >
            Phase 2 Human-in-the-Loop Approval Gate · Risk → Probability → Plan → Draft → Review
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--paper-warm)',
            border: 'var(--stroke)',
            borderRadius: '3px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
          }}
        >
          <Bot size={15} />
          <span>MOCK SWEEP ENGINE</span>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="secondary"
            style={{ padding: '7px 12px', fontSize: '0.8rem' }}
            title="Reload invoices"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            <span>Reset</span>
          </button>
        )}
      </div>
    </header>
  );
};
