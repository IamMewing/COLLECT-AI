import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import gsap from 'gsap';

interface LoadStep {
  label: string;
  done: boolean;
}

export const DashboardLoader: React.FC = () => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const loadAllData = useStore(s => s.loadAllData);
  const fetchBusinesses = useStore(s => s.fetchBusinesses);

  const [steps, setSteps] = useState<LoadStep[]>([
    { label: 'Connecting to workspace', done: false },
    { label: 'Loading clients',         done: false },
    { label: 'Loading invoices',         done: false },
    { label: 'Initializing AI context', done: false },
    { label: 'Connected',               done: false },
  ]);
  const [ready, setReady] = useState(false);

  const markDone = (index: number) =>
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, done: true } : s));

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // Step 0: connect
      await new Promise(r => setTimeout(r, 300));
      if (cancelled) return;
      markDone(0);

      // Step 1 + 2: fetch data while marking UI steps
      const dataLoad = Promise.all([fetchBusinesses(), loadAllData()]);
      await new Promise(r => setTimeout(r, 400));
      if (cancelled) return;
      markDone(1);
      await new Promise(r => setTimeout(r, 300));
      if (cancelled) return;
      markDone(2);

      // Wait for actual data
      await dataLoad;
      if (cancelled) return;
      markDone(3);
      await new Promise(r => setTimeout(r, 250));
      if (cancelled) return;
      markDone(4);
      await new Promise(r => setTimeout(r, 350));
      if (!cancelled) setReady(true);
    };

    run();
    return () => { cancelled = true; };
  }, []);

  // Fade out then navigate
  useEffect(() => {
    if (!ready) return;
    if (containerRef.current) {
      gsap.to(containerRef.current, {
        opacity: 0,
        duration: 0.5,
        ease: 'power2.inOut',
        onComplete: () => navigate('/', { replace: true }),
      });
    } else {
      navigate('/', { replace: true });
    }
  }, [ready, navigate]);

  const doneCount = steps.filter(s => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div ref={containerRef} style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--paper)',
      gap: '32px',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '36px', height: '36px',
          background: 'var(--yellow)',
          border: '2px solid var(--ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.1rem',
          animation: 'spin 8s linear infinite',
        }}>⚡</div>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.3rem',
          fontWeight: 800,
          letterSpacing: '-0.02em',
        }}>CollectAI</span>
      </div>

      {/* Step list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '260px' }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            opacity: step.done ? 1 : i === doneCount ? 1 : 0.25,
            transition: 'opacity 0.4s ease',
          }}>
            <div style={{ width: '16px', flexShrink: 0, textAlign: 'center' }}>
              {step.done ? (
                <span style={{ color: '#1a7f4b', fontWeight: 700, fontSize: '0.85rem' }}>✓</span>
              ) : i === doneCount ? (
                <span style={{
                  display: 'inline-block',
                  width: '10px', height: '10px',
                  border: '1.5px solid var(--border)',
                  borderTopColor: 'var(--ink)',
                  borderRadius: '50%',
                  animation: 'spin 0.7s linear infinite',
                }} />
              ) : (
                <span style={{ color: 'var(--border)', fontSize: '0.8rem' }}>○</span>
              )}
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-label)',
              color: step.done ? 'var(--muted)' : i === doneCount ? 'var(--ink)' : 'var(--border)',
              fontWeight: i === doneCount ? 600 : 400,
              transition: 'color 0.3s',
            }}>
              {step.label}{i === doneCount && !step.done ? '...' : ''}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ width: '260px' }}>
        <div style={{ height: '2px', background: 'var(--border)', borderRadius: '1px' }}>
          <div style={{
            height: '100%',
            background: 'var(--ink)',
            width: `${progress}%`,
            borderRadius: '1px',
            transition: 'width 0.4s var(--ease-out)',
          }} />
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default DashboardLoader;
