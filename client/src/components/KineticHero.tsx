import React, { useEffect, useRef, useState } from 'react';

/**
 * KineticHero — Bitnomial-scale bold typography + Design-Bomb kinetic motion.
 * Huge oversized headline words reveal with a mask-slide, a flowing SVG
 * line-wave animates continuously behind them, and a marquee ticker runs below.
 * Sits above the dashboard as a full-viewport intro band.
 */

const WORDS = ['COLLECT.', 'PREDICT.', 'DRAFT.', 'APPROVE.'];

// Canvas-drawn wave — NOT SVG-with-mutated-paths. Mutating an SVG path's `d`
// attribute forces a re-parse + re-layout of that element every frame;
// drawing the same curves on a canvas is a direct pixel fill with no DOM
// or layout cost, which is what keeps this at a real 60fps.
const LineWave: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0, h = 0;
    const resize = () => {
      const parent = canvas.parentElement;
      w = canvas.width = parent ? parent.clientWidth : window.innerWidth;
      h = canvas.height = parent ? parent.clientHeight : window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const LINES = 12;
    const COLORS = ['rgba(255,210,63,0.28)', 'rgba(0,229,199,0.20)', 'rgba(255,59,107,0.15)'];

    let t = 0, raf = 0;
    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h);
      const midY = h * 0.5;
      for (let i = 0; i < LINES; i++) {
        const off = i * 0.5;
        const amp = (50 + i * 8) * (h / 600);
        const yBase = midY + (i - LINES / 2) * (h / 42);
        ctx.beginPath();
        ctx.strokeStyle = COLORS[i % COLORS.length];
        ctx.lineWidth = 1;
        const steps = 40;
        for (let s = 0; s <= steps; s++) {
          const x = (s / steps) * (w + 200) - 100;
          const y = yBase + Math.sin(t + off + s * 0.18) * amp * Math.sin(s * 0.12 + t * 0.3);
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (!reduced) {
        t += 0.02;
        raf = requestAnimationFrame(drawFrame);
      }
    };
    drawFrame();

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} className="wave-svg" aria-hidden="true" />;
};

export const KineticHero: React.FC = () => {
  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(() => setWordIdx((i) => (i + 1) % WORDS.length), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="kinetic-hero">
      <LineWave />
      <div className="kinetic-hero-inner">
        <div className="hero-eyebrow reveal d1">
          <span className="hero-bracket">[</span>
          AUTONOMOUS RECEIVABLES · STRANDS MULTI-AGENT · HUMAN-IN-THE-LOOP
          <span className="hero-bracket">]</span>
        </div>

        <h1 className="hero-mega">
          <span className="hero-line reveal d2">AGENTS THAT</span>
          <span className="hero-line reveal d3">CHASE THE</span>
          <span className="hero-line hero-rotator reveal d4">
            <span className="hero-rotator-track" style={{ transform: `translateY(-${wordIdx * 1.02}em)` }}>
              {WORDS.map((w) => (
                <span key={w} className="hero-rotator-word">{w}</span>
              ))}
            </span>
          </span>
        </h1>

        <p className="hero-sub reveal d4">
          A ₹4L invoice doesn't kill a business on day 90. It kills it on day 30 —
          when the owner is too busy to chase it. CollectAI does the chasing, in your
          voice, with your approval.
        </p>
      </div>

      {/* running marquee ticker */}
      <div className="hero-ticker">
        <div className="hero-ticker-track">
          {Array.from({ length: 2 }).map((_, r) => (
            <span key={r} className="hero-ticker-run">
              RISK ASSESSMENT&nbsp;&nbsp;✦&nbsp;&nbsp;PAYMENT PROBABILITY&nbsp;&nbsp;✦&nbsp;&nbsp;
              ACTION PLANNING&nbsp;&nbsp;✦&nbsp;&nbsp;TONE-MATCHED DRAFTING&nbsp;&nbsp;✦&nbsp;&nbsp;
              HUMAN APPROVAL&nbsp;&nbsp;✦&nbsp;&nbsp;OUTCOME REFLECTION&nbsp;&nbsp;✦&nbsp;&nbsp;
              PERSISTENT CLIENT MEMORY&nbsp;&nbsp;✦&nbsp;&nbsp;
            </span>
          ))}
        </div>
      </div>

      <div className="hero-scroll-cue reveal d4">
        <span className="mono-label">SCROLL TO LEDGER</span>
        <span className="hero-scroll-line" />
      </div>
    </section>
  );
};

export default KineticHero;
