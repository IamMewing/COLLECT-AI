import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';

interface CommandCardProps {
  label: string;
  value: string | number;
  icon?: string;
  badge?: string;
  color?: string;
}

export const CommandCard: React.FC<CommandCardProps> = ({ 
  label, 
  value, 
  icon, 
  badge,
  color = 'var(--white)' 
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    
    // Stagger animation
    gsap.fromTo(cardRef.current,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out' }
    );

    // Number counting transition if it's a numeric string
    const stringVal = String(value);
    const numericOnly = stringVal.replace(/[^0-9]/g, '');
    if (numericOnly && !isNaN(Number(numericOnly)) && valueRef.current) {
      const parsed = Number(numericOnly);
      const targetObj = { val: 0 };
      gsap.to(targetObj, {
        val: parsed,
        duration: 0.8,
        ease: 'power3.out',
        onUpdate: () => {
          if (valueRef.current) {
            // Re-format with appropriate prefix/suffix
            const isCurrency = stringVal.includes('₹');
            const isPercent = stringVal.includes('%');
            const isHours = stringVal.includes('h');
            
            let formatted = Math.round(targetObj.val).toLocaleString('en-IN');
            if (isCurrency) formatted = `₹${formatted}`;
            if (isPercent) formatted = `${formatted}%`;
            if (isHours) formatted = `${formatted}h`;
            
            valueRef.current.innerText = formatted;
          }
        }
      });
    }
  }, [value]);

  return (
    <div 
      ref={cardRef}
      className="os-card hover-lift"
      style={{
        backgroundColor: color,
        border: 'var(--stroke-thick)',
        boxShadow: 'var(--shadow-flat-md)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '140px',
        padding: '20px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span 
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: 'var(--muted)',
            letterSpacing: '0.05em'
          }}
        >
          {label}
        </span>
        {icon && <span style={{ fontSize: '1.25rem' }}>{icon}</span>}
      </div>

      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div 
          ref={valueRef}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2rem',
            fontWeight: 800,
            lineHeight: 1,
            color: 'var(--ink)'
          }}
        >
          {value}
        </div>
        {badge && (
          <span 
            className="stamp-overlay stamp-open"
            style={{
              fontSize: '0.62rem',
              padding: '2px 6px',
              borderWidth: '2px',
              boxShadow: '1px 1px 0 var(--ink)',
              transform: 'rotate(-2deg)'
            }}
          >
            {badge}
          </span>
        )}
      </div>
    </div>
  );
};
