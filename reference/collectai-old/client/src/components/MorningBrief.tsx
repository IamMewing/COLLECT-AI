import React from 'react';
import { MaskText } from './MaskText';

interface MorningBriefProps {
  businessName?: string;
  recoveredAmount: number;
  openCount: number;
}

export const MorningBrief: React.FC<MorningBriefProps> = ({ 
  businessName = 'there', 
  recoveredAmount,
  openCount
}) => {
  const briefText = `Good morning, ${businessName}. Yesterday CollectAI recovered ₹${recoveredAmount.toLocaleString('en-IN')} across your service contracts. There are ${openCount} active collection cycles running today. No manual intervention required.`;

  return (
    <div 
      className="os-card"
      style={{
        backgroundColor: 'var(--yellow)',
        border: 'var(--stroke-thick)',
        boxShadow: 'var(--shadow-flat-md)',
        padding: '24px',
        marginBottom: '32px'
      }}
    >
      <h4 
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          marginBottom: '8px',
          color: 'var(--ink)',
          letterSpacing: '0.05em'
        }}
      >
        DAILY INTELLIGENCE BRIEF
      </h4>
      <p 
        style={{
          fontSize: '1.25rem',
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          lineHeight: '1.4',
          color: 'var(--ink)'
        }}
      >
        <MaskText text={briefText} duration={0.6} stagger={0.015} />
      </p>
    </div>
  );
};
