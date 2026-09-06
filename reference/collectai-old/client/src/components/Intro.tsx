import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useStore } from '../store/useStore';

export const Intro: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const setIntroCompleted = useStore((state) => state.setIntroCompleted);
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    'Good morning.',
    'Loading business intelligence...',
    'Loading client invoices...',
    'Loading customer relationship memories...',
    'Initializing Gemini AI models...',
    'Checking invoice history & risk tables...',
    'Preparing autonomous collections agent...'
  ];

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => {
        // Fade out transition
        gsap.to(containerRef.current, {
          opacity: 0,
          duration: 0.6,
          ease: 'power2.out',
          onComplete: () => {
            setIntroCompleted(true);
          }
        });
      }
    });

    // Animate logo initial bounce/slam
    tl.fromTo(logoRef.current, 
      { scale: 0.6, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' }
    );

    // Stagger step updates
    steps.forEach((_, idx) => {
      tl.to({}, {
        duration: idx === 0 ? 0.8 : 0.45,
        onStart: () => {
          setActiveStep(idx);
        }
      });
    });

    // Final hold
    tl.to({}, { duration: 0.5 });

    return () => {
      tl.kill();
    };
  }, []);

  return (
    <div 
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#0A0A0A',
        color: '#FAFAF7',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        fontFamily: 'monospace'
      }}
    >
      <div 
        ref={logoRef}
        style={{
          fontSize: '2.5rem',
          fontWeight: 800,
          fontFamily: "'Space Grotesk', sans-serif",
          color: '#FFD400',
          marginBottom: '32px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <span>⚡</span> COLLECTAI
      </div>

      <div 
        ref={textContainerRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          height: '240px',
          justifyContent: 'center',
          maxWidth: '500px',
          width: '100%',
          textAlign: 'center'
        }}
      >
        {steps.map((step, idx) => {
          const isVisible = idx <= activeStep;
          const isActive = idx === activeStep;

          return (
            <div 
              key={idx}
              style={{
                fontSize: idx === 0 ? '1.5rem' : '0.9rem',
                fontWeight: idx === 0 ? 'bold' : 'normal',
                fontFamily: idx === 0 ? "'Space Grotesk', sans-serif" : "'JetBrains Mono', monospace",
                opacity: isActive ? 1 : isVisible ? 0.4 : 0,
                color: isActive ? '#FFD400' : '#FAFAF7',
                transform: isActive ? 'scale(1.02)' : 'scale(1)',
                transition: 'opacity 0.25s, transform 0.25s, color 0.25s'
              }}
            >
              {isVisible && (isActive ? `> ${step}` : `✓ ${step}`)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
