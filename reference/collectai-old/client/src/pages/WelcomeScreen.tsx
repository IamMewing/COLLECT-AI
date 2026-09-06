import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { markTourComplete } from '../lib/workspace';
import { useStore } from '../store/useStore';
import { db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import gsap from 'gsap';

export const WelcomeScreen: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const startTour = useStore((s) => s.startTour);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [displayName, setDisplayName] = useState<string>('');

  // Resolve the best available display name:
  // Firestore profile.displayName → Firestore displayName → Firebase Auth displayName → email prefix → "there"
  useEffect(() => {
    const resolve = async () => {
      if (!user?.uid) {
        setDisplayName(user?.displayName?.split(' ')[0] || 'there');
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const d = snap.data();
          const name =
            d.profile?.displayName ||
            d.displayName ||
            user.displayName ||
            user.email?.split('@')[0] ||
            'there';
          setDisplayName(name.split(' ')[0]);
          return;
        }
      } catch { /* ignore */ }
      setDisplayName(user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'there');
    };
    resolve();
  }, [user]);

  // Entrance animation
  useEffect(() => {
    if (!containerRef.current) return;
    const tl = gsap.timeline();
    tl.fromTo(containerRef.current,
      { opacity: 0 },
      { opacity: 1, duration: 0.6, ease: 'power2.out' }
    );
    tl.fromTo(
      containerRef.current.querySelectorAll('.welcome-item'),
      { opacity: 0, y: 20 },
      { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out' },
      '-=0.2'
    );
  }, []);

  const handleStartTour = () => {
    gsap.to(containerRef.current, {
      opacity: 0, duration: 0.35, ease: 'power2.in',
      onComplete: () => {
        // Navigate to dashboard first, then activate tour via store
        navigate('/', { replace: true });
        startTour();
      },
    });
  };

  const handleSkipTour = async () => {
    if (user?.uid) {
      // Set session flag immediately to prevent AuthGuard loop
      sessionStorage.setItem('tourCompleted', user.uid);
      markTourComplete(user.uid).catch(console.error);
    }
    gsap.to(containerRef.current, {
      opacity: 0, duration: 0.35, ease: 'power2.in',
      onComplete: () => navigate('/', { replace: true }),
    });
  };

  return (
    <div ref={containerRef} style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--paper)',
      padding: '40px',
      opacity: 0,
    }}>
      <div style={{
        maxWidth: '560px',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '40px',
        textAlign: 'center',
      }}>
        {/* Hero mark */}
        <div className="welcome-item" style={{
          width: '80px', height: '80px',
          background: 'var(--yellow)',
          border: '3px solid var(--ink)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2.2rem',
          boxShadow: 'var(--shadow-flat-lg)',
        }}>
          ⚡
        </div>

        {/* Headline */}
        <div className="welcome-item">
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '2.8rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
          }}>
            Welcome to CollectAI,<br />{displayName || '…'}.
          </h1>
          <p style={{
            marginTop: '16px',
            fontSize: '1.05rem',
            color: 'var(--muted)',
            lineHeight: 1.65,
          }}>
            Your AI employee is ready to start recovering unpaid invoices.<br />
            Let's take a quick tour so you know exactly how it works.
          </p>
        </div>

        {/* Feature highlight cards */}
        <div ref={cardsRef} className="welcome-item" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '12px',
          width: '100%',
        }}>
          {[
            { icon: '🧠', title: 'Gemini AI', body: 'Reads context, reasons, writes personalized reminders' },
            { icon: '📋', title: 'Invoice Engine', body: 'Tracks overdue dates and escalation levels automatically' },
            { icon: '🔄', title: 'Autonomous', body: 'Runs collection cycles without you lifting a finger' },
          ].map(card => (
            <div key={card.title} style={{
              padding: '20px 16px',
              background: 'var(--white)',
              border: 'var(--stroke-subtle)',
              borderRadius: '4px',
              textAlign: 'left',
            }}>
              <div style={{ fontSize: '1.6rem', marginBottom: '10px' }}>{card.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-caption)', marginBottom: '6px' }}>{card.title}</div>
              <div style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', lineHeight: 1.5 }}>{card.body}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="welcome-item" style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', maxWidth: '320px' }}>
          <button
            className="primary"
            onClick={handleStartTour}
            style={{ width: '100%', padding: '16px', fontSize: 'var(--text-body)' }}
          >
            ▶ Start Product Tour
          </button>
          <button
            type="button"
            onClick={handleSkipTour}
            style={{
              background: 'none', border: 'none', boxShadow: 'none', padding: '8px',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)',
              color: 'var(--muted)', cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Skip tour — take me to the dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
