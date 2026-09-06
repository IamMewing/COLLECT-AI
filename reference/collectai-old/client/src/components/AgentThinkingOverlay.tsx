import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useStore } from '../store/useStore';

export const AgentThinkingOverlay: React.FC = () => {
  const isThinking = useStore((state) => state.isThinking);
  const thinkingProgress = useStore((state) => state.thinkingProgress);
  const thinkingStep = useStore((state) => state.thinkingStep);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isThinking) {
      // Slide overlay in
      gsap.fromTo(overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: 'power2.out' }
      );
      gsap.fromTo(cardRef.current,
        { y: 50, scale: 0.95 },
        { y: 0, scale: 1, duration: 0.4, ease: 'back.out(1.5)' }
      );
    }
  }, [isThinking]);

  if (!isThinking) return null;

  return (
    <div 
      ref={overlayRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 10, 10, 0.75)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backdropFilter: 'blur(2px)'
      }}
    >
      <div 
        ref={cardRef}
        className="os-card"
        style={{
          width: '100%',
          maxWidth: '540px',
          backgroundColor: 'var(--paper)',
          border: 'var(--stroke-thick)',
          boxShadow: 'var(--shadow-flat-lg)',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 'var(--stroke)', paddingBottom: '12px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 800 }}>
            🧠 AGENT DECISION CYCLE
          </h3>
          <span 
            className="stamp-overlay stamp-nudge"
            style={{ animation: 'spin 10s linear infinite' }}
          >
            ACTIVE RUN
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '300px' }}>
          {thinkingProgress.map((step, idx) => (
            <div 
              key={idx}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0'
              }}
            >
              <span style={{ color: 'var(--ink)' }}>{step}</span>
              <span style={{ color: 'var(--mint)', fontWeight: 'bold' }}>[ COMPLETE ]</span>
            </div>
          ))}

          {thinkingStep < 9 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
                <span>processing pipeline stage...</span>
                <span>{Math.round((thinkingStep / 9) * 100)}%</span>
              </div>
              <div style={{ height: '8px', border: 'var(--stroke)', background: 'var(--paper-warm)' }}>
                <div 
                  style={{
                    height: '100%',
                    background: 'var(--yellow)',
                    width: `${(thinkingStep / 9) * 100}%`,
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {thinkingStep === 9 && (
          <div 
            style={{
              padding: '16px',
              backgroundColor: 'var(--lavender)',
              border: 'var(--stroke)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '12px'
            }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>AI DECISION COMPLETE</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>CONFIDENCE: 94%</span>
          </div>
        )}
      </div>
    </div>
  );
};
