import React, { useEffect, useRef } from 'react';

/**
 * AmbientBackground — cinematic multi-layer field behind the whole app.
 * Layer 1: CSS aurora blobs (drifting colored light)
 * Layer 2: fine trading-terminal grid (masked to fade at edges)
 * Layer 3: canvas "cash-flow" particle streams — thin luminous lines
 *          drifting horizontally like ticker data.
 * Layer 4: vignette for cinematic depth.
 * Respects prefers-reduced-motion (canvas becomes static).
 */
export const AmbientBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const COLORS = ['0,229,199', '255,210,63', '255,59,107'];
    type Streak = { x: number; y: number; len: number; speed: number; c: string; a: number };
    const streaks: Streak[] = [];
    const COUNT = Math.min(38, Math.floor(w / 42));

    for (let i = 0; i < COUNT; i++) {
      streaks.push({
        x: Math.random() * w,
        y: Math.random() * h,
        len: 60 + Math.random() * 160,
        speed: 0.25 + Math.random() * 0.9,
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
        a: 0.04 + Math.random() * 0.10,
      });
    }

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1.2;
      for (const s of streaks) {
        // Plain solid stroke, not a fresh createLinearGradient() per streak
        // per frame — that was allocating up to 38 gradient objects, 60
        // times a second, which is real GC pressure and a classic source
        // of canvas micro-stutter. A solid low-alpha stroke reads visually
        // identical for thin 1px lines and costs nothing to allocate.
        ctx.strokeStyle = `rgba(${s.c},${s.a})`;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + s.len, s.y);
        ctx.stroke();

        if (!reduced) {
          s.x += s.speed;
          if (s.x > w + s.len) { s.x = -s.len; s.y = Math.random() * h; }
        }
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();

    const onResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <>
      <div className="aurora-field">
        <div className="aurora-blob a" />
        <div className="aurora-blob b" />
        <div className="aurora-blob c" />
      </div>
      <canvas
        ref={canvasRef}
        style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.9 }}
      />
      <div className="grid-overlay" />
      <div className="vignette" />
    </>
  );
};

export default AmbientBackground;
