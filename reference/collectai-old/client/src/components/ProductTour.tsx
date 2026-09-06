import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { markTourComplete } from '../lib/workspace';
import gsap from 'gsap';

// ─── Tour step definitions ────────────────────────────────────────────────────

interface TourStep {
  targetId: string;       // data-tour-id attribute on the DOM element
  title: string;
  body: string;
  placement: 'right' | 'left' | 'bottom' | 'top';
  route?: string;         // Route to navigate to before showing step
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: 'tour-dashboard',
    title: 'Mission Control',
    body: 'Your daily briefing. See what the AI has done, what\'s overdue, and how much has been recovered — all in real time.',
    placement: 'right',
    route: '/'
  },
  {
    targetId: 'tour-clients',
    title: 'Client Profiles',
    body: 'Every client you work with. The AI builds a profile of their payment behaviour so reminders feel personal.',
    placement: 'right',
    route: '/'
  },
  {
    targetId: 'tour-collections',
    title: 'Collections',
    body: 'Every active invoice at a glance. Track status, amounts, and escalation level across your entire book of business.',
    placement: 'right',
    route: '/'
  },
  {
    targetId: 'tour-timeline',
    title: 'Timeline',
    body: 'A log of every message the AI sent. See exactly what was said, when, and what the outcome was.',
    placement: 'right',
    route: '/'
  },
  {
    targetId: 'tour-insights',
    title: 'Insights',
    body: 'Collection analytics — recovery rates, average overdue duration, and which clients pay fastest.',
    placement: 'right',
    route: '/'
  },
  {
    targetId: 'tour-watch-ai',
    title: 'Watch AI Work',
    body: 'Trigger and watch the AI run collection scan cycles and execute actions in real time.',
    placement: 'bottom',
    route: '/'
  },
  {
    targetId: 'tour-create-client',
    title: 'Create Client',
    body: 'Onboard new client accounts with custom contact info, payment terms, and relationship memory.',
    placement: 'bottom',
    route: '/clients'
  },
  {
    targetId: 'tour-add-invoice',
    title: 'Create Invoice',
    body: 'Add a new invoice and the AI immediately begins monitoring it for overdue status. Zero manual follow-up needed.',
    placement: 'right',
    route: '/clients'
  },
  {
    targetId: 'tour-settings',
    title: 'Settings',
    body: 'Control the AI\'s behaviour — reminder tone, frequency, timezone, and your workspace preferences.',
    placement: 'right',
    route: '/clients'
  },
  {
    targetId: 'tour-ai-employee',
    title: 'Your AI Employee',
    body: 'Deploy your AI employee from any page. Ask: "Who owes me the most?" "Send a reminder to Rahul." It understands real intent.',
    placement: 'left',
    route: '/'
  },
];

// ─── Tooltip placement ────────────────────────────────────────────────────────

function getTooltipPosition(rect: DOMRect, placement: TourStep['placement'], tw = 320, th = 190) {
  const M = 20, A = 16;
  switch (placement) {
    case 'right':  return { top: rect.top + rect.height / 2 - th / 2, left: rect.right + M + A };
    case 'left':   return { top: rect.top + rect.height / 2 - th / 2, left: rect.left - tw - M - A };
    case 'bottom': return { top: rect.bottom + M + A, left: rect.left + rect.width / 2 - tw / 2 };
    case 'top':    return { top: rect.top - th - M - A,  left: rect.left + rect.width / 2 - tw / 2 };
  }
}

const getArrowStyle = (placement: TourStep['placement']) => {
  const base = { position: 'absolute' as const, width: 0, height: 0, borderStyle: 'solid' };
  switch (placement) {
    case 'right':  return { ...base, left: '-8px', top: 'calc(50% - 8px)', borderWidth: '8px 8px 8px 0', borderColor: 'transparent var(--yellow) transparent transparent' };
    case 'left':   return { ...base, right: '-8px', top: 'calc(50% - 8px)', borderWidth: '8px 0 8px 8px', borderColor: 'transparent transparent transparent var(--yellow)' };
    case 'bottom': return { ...base, top: '-8px', left: 'calc(50% - 8px)', borderWidth: '0 8px 8px 8px', borderColor: 'transparent transparent var(--yellow) transparent' };
    case 'top':    return { ...base, bottom: '-8px', left: 'calc(50% - 8px)', borderWidth: '8px 8px 0 8px', borderColor: 'var(--yellow) transparent transparent transparent' };
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export const ProductTour: React.FC<{ onEnd: () => void }> = ({ onEnd }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [stepIndex, setStepIndex] = useState(0);
  const [spotRect, setSpotRect] = useState<DOMRect | null>(null);
  const [finishing, setFinishing] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const currentStep = TOUR_STEPS[stepIndex];

  // ── Animate tooltip in on step change ──
  useEffect(() => {
    if (!tooltipRef.current) return;
    gsap.fromTo(tooltipRef.current,
      { opacity: 0, scale: 0.92, y: 8 },
      { opacity: 1, scale: 1, y: 0, duration: 0.25, ease: 'power2.out' }
    );
  }, [stepIndex]);

  // ── Navigate to the required route for the current step ──
  useEffect(() => {
    if (currentStep.route && location.pathname !== currentStep.route) {
      navigate(currentStep.route, { replace: true });
      setSpotRect(null);
    }
  }, [stepIndex]); // only run when step changes, not on every location change

  // ── Poll for target element after step/route change ──
  useEffect(() => {
    let attempts = 0;
    let scrolled = false;
    setSpotRect(null);

    const poll = setInterval(() => {
      const el = document.querySelector(`[data-tour-id="${currentStep.targetId}"]`);
      if (el) {
        clearInterval(poll);
        if (!scrolled) {
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          scrolled = true;
        }
        // Wait a frame for scroll to settle before computing rect
        requestAnimationFrame(() => {
          setSpotRect(el.getBoundingClientRect());
        });
      } else {
        attempts++;
        if (attempts > 40) { // 4 seconds max
          clearInterval(poll);
          setSpotRect(null);
        }
      }
    }, 100);

    // Update rect on scroll/resize — but DON'T scrollIntoView from here
    const updateRect = () => {
      const el = document.querySelector(`[data-tour-id="${currentStep.targetId}"]`);
      if (el) setSpotRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', updateRect, { passive: true });
    window.addEventListener('scroll', updateRect, { passive: true });

    return () => {
      clearInterval(poll);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect);
    };
  }, [currentStep.targetId]);

  // ── Finish: write completion state, unmount tour ──
  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);

    // 1. Set session flag immediately — prevents AuthGuard loop while Firestore propagates
    if (user?.uid) {
      sessionStorage.setItem('tourCompleted', user.uid);
    }

    // 2. Animate overlay out
    if (overlayRef.current) {
      await new Promise<void>(resolve => {
        gsap.to(overlayRef.current!, { opacity: 0, duration: 0.3, ease: 'power2.in', onComplete: resolve });
      });
    }

    // 3. Persist to Firestore (non-blocking — session flag already set)
    if (user?.uid) {
      markTourComplete(user.uid).catch(e => console.warn('Tour complete write failed:', e));
    }

    // 4. Call onEnd — this sets store tourActive = false → Layout unmounts this component
    onEnd();
  }, [user, onEnd, finishing]);

  const goNext = useCallback(() => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex(i => i + 1);
    } else {
      finish();
    }
  }, [stepIndex, finish]);

  const goBack = useCallback(() => {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  }, [stepIndex]);

  // ── Derived positioning ──
  const TW = 320, TH = 200;

  const rawPos = spotRect
    ? getTooltipPosition(spotRect, currentStep.placement, TW, TH)
    : { top: window.innerHeight / 2 - TH / 2, left: window.innerWidth / 2 - TW / 2 };

  const tooltipPos = {
    top:  Math.max(12, Math.min(rawPos.top,  window.innerHeight - TH - 12)),
    left: Math.max(12, Math.min(rawPos.left, window.innerWidth  - TW - 12)),
  };

  const PAD = 8;
  const spotlight = spotRect ? {
    top:    spotRect.top  - PAD,
    left:   spotRect.left - PAD,
    width:  spotRect.width  + PAD * 2,
    height: spotRect.height + PAD * 2,
  } : null;

  return (
    <div
      ref={overlayRef}
      style={{ position: 'fixed', inset: 0, zIndex: 99998, pointerEvents: 'none' }}
    >
      {/* Dark overlay with spotlight cutout */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.left} y={spotlight.top}
                width={spotlight.width} height={spotlight.height}
                rx="4" fill="black"
              />
            )}
          </mask>
        </defs>

        {/* Dark overlay — blocks interaction outside spotlight */}
        <rect
          width="100%" height="100%"
          fill="rgba(10,10,10,0.75)"
          mask="url(#tour-spotlight-mask)"
          style={{ pointerEvents: 'all' }}
          onClick={(e) => e.stopPropagation()}
        />

        {/* Spotlight border */}
        {spotlight && (
          <>
            <rect
              x={spotlight.left} y={spotlight.top}
              width={spotlight.width} height={spotlight.height}
              rx="4" fill="none"
              stroke="var(--yellow)" strokeWidth="2"
            />
            {/* Subtle pulse — animates opacity only, no scale/position changes */}
            <rect
              x={spotlight.left - 4} y={spotlight.top - 4}
              width={spotlight.width + 8} height={spotlight.height + 8}
              rx="6" fill="none"
              stroke="var(--yellow)" strokeWidth="1"
            >
              <animate attributeName="opacity" values="0.6;0;0.6" dur="2.5s" repeatCount="indefinite" />
            </rect>
          </>
        )}
      </svg>

      {/* Tooltip — pointer events active for navigation buttons */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: TW,
          background: 'var(--ink)',
          color: 'var(--paper)',
          border: '2px solid var(--yellow)',
          borderRadius: '4px',
          padding: '22px 24px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.65)',
          zIndex: 99999,
          pointerEvents: 'all',
          transition: 'top 0.18s ease, left 0.18s ease',
        }}
      >
        {spotRect && <div style={getArrowStyle(currentStep.placement)} />}

        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
          color: 'rgba(255,255,255,0.35)', marginBottom: '8px', letterSpacing: '0.08em',
        }}>
          STEP {stepIndex + 1} / {TOUR_STEPS.length}
        </div>

        <h3 style={{
          fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700,
          marginBottom: '8px', color: 'var(--yellow)',
        }}>
          {currentStep.title}
        </h3>

        <p style={{
          fontFamily: 'var(--font-sans)', fontSize: '0.8rem',
          color: 'rgba(255,255,255,0.78)', lineHeight: 1.6, marginBottom: '18px',
        }}>
          {currentStep.body}
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
          {TOUR_STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === stepIndex ? '16px' : '4px', height: '4px', borderRadius: '2px',
              background: i <= stepIndex ? 'var(--yellow)' : 'rgba(255,255,255,0.18)',
              transition: 'all 0.25s ease',
            }} />
          ))}
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={finish}
            disabled={finishing}
            style={{
              background: 'none', border: 'none', boxShadow: 'none', padding: 0,
              fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
              color: 'rgba(255,255,255,0.35)', cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={goBack}
                disabled={finishing}
                style={{
                  padding: '8px 14px', background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: '3px',
                  color: 'var(--paper)', fontFamily: 'var(--font-mono)',
                  fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600,
                }}
              >
                ← Back
              </button>
            )}
            <button
              type="button"
              onClick={goNext}
              disabled={finishing}
              style={{
                padding: '8px 18px', background: 'var(--yellow)',
                border: '2px solid var(--yellow)', borderRadius: '3px',
                color: 'var(--ink)', fontFamily: 'var(--font-mono)',
                fontSize: '0.72rem', cursor: 'pointer', fontWeight: 700,
              }}
            >
              {finishing ? '...' : stepIndex === TOUR_STEPS.length - 1 ? 'Finish ✓' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductTour;
