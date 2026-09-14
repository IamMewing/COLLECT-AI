import React, { useEffect, useRef } from 'react';

const ECHO_COLORS = [
  'rgba(255,210,63,ALPHA)',
  'rgba(0,229,199,ALPHA)',
  'rgba(255,59,107,ALPHA)',
  'rgba(255,159,28,ALPHA)',
];

// The real classic OS arrow-cursor silhouette — thin body, tip top-left,
// straight left edge, small angled barb/notch on the right. This is what
// an actual Windows/Mac pointer looks like, not a wide dart shape.
const POINTER_PATH: [number, number][] = [
  [0, 0], [0, 16], [4, 12.5], [6.5, 18], [8.5, 17], [6, 11.5], [11, 11.5],
];

function drawPointerGhost(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, alpha: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(POINTER_PATH[0][0], POINTER_PATH[0][1]);
  for (let i = 1; i < POINTER_PATH.length; i++) ctx.lineTo(POINTER_PATH[i][0], POINTER_PATH[i][1]);
  ctx.closePath();
  ctx.fillStyle = color.replace('ALPHA', alpha.toFixed(3));
  ctx.fill();
  ctx.restore();
}

const ECHO_COUNT = 4;
const LERP_FACTORS = [0.32, 0.24, 0.18, 0.13];
// This shape's own coordinates are much smaller (~11x18) than the old dart
// (~30x42), so scale multipliers are boosted proportionally to render at
// the same on-screen size as before.
const SCALES = [2.2, 1.9, 1.6, 1.3];
const ALPHAS = [0.85, 0.72, 0.58, 0.44];

export const InteractionLayer: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const hoveringRef = useRef(false);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });
  const echoesRef = useRef(
    Array.from({ length: ECHO_COUNT }, () => ({ x: -9999, y: -9999 }))
  );
  const magnetElsRef = useRef<HTMLElement[]>([]);
  const magnetRefreshRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      if (!mouseRef.current.active) {
        echoesRef.current.forEach((ec) => { ec.x = e.clientX; ec.y = e.clientY; });
        mouseRef.current.active = true;
      }
    };

    const isInteractive = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest('button, a, input, textarea, [role="button"], .invoice-chip');
    const onOver = (e: MouseEvent) => { hoveringRef.current = isInteractive(e.target); };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseover', onOver, { passive: true });

    const render = (t: number) => {
      const { x, y, active } = mouseRef.current;

      if (active) {
        const echoes = echoesRef.current;
        let targetX = x, targetY = y;
        for (let i = 0; i < ECHO_COUNT; i++) {
          const ec = echoes[i];
          ec.x += (targetX - ec.x) * LERP_FACTORS[i];
          ec.y += (targetY - ec.y) * LERP_FACTORS[i];
          targetX = ec.x; targetY = ec.y;
        }
      }

      if (t - magnetRefreshRef.current > 500) {
        magnetElsRef.current = Array.from(document.querySelectorAll<HTMLElement>('button.btn'));
        magnetRefreshRef.current = t;
      }
      for (const el of magnetElsRef.current) {
        if (el.hasAttribute('disabled')) { if (el.style.transform) el.style.transform = ''; continue; }
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = 70;
        if (dist < radius) {
          const pull = 1 - dist / radius;
          el.style.transform = `translate(${(dx * pull * 0.22).toFixed(1)}px, ${(dy * pull * 0.22).toFixed(1)}px)`;
        } else if (el.style.transform) {
          el.style.transform = '';
        }
      }

      ctx.clearRect(0, 0, w, h);
      if (active) {
        const boost = hoveringRef.current ? 1.25 : 1;
        for (let i = ECHO_COUNT - 1; i >= 0; i--) {
          const ec = echoesRef.current[i];
          drawPointerGhost(ctx, ec.x, ec.y, SCALES[i] * boost, ALPHAS[i], ECHO_COLORS[i]);
        }
      }
      rafRef.current = requestAnimationFrame(render);
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onOver);
      magnetElsRef.current.forEach((el) => { el.style.transform = ''; });
    };
  }, []);

  return <canvas ref={canvasRef} className="cursor-trail-canvas" aria-hidden="true" />;
};

export default InteractionLayer;
