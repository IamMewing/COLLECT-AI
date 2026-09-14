import React, { useEffect, useRef } from 'react';

/**
 * InteractionLayer — native OS pointer + EXACTLY 4 colored echo-copies of
 * a bold pointer/dart icon that chain-follow the cursor with increasing
 * lag (each echo trails the one in front of it, not the raw mouse) —
 * a fixed, bounded set, never spawned/destroyed, so there is no growing
 * "comet tail." Plus magnetic hover on primary buttons.
 *
 * Colors are strictly the site's 4 signal tokens, one per echo, fixed.
 */

const ECHO_COLORS = [
  'rgba(255,210,63,ALPHA)',  // --gold      (closest to the real cursor)
  'rgba(0,229,199,ALPHA)',   // --healthy
  'rgba(255,59,107,ALPHA)',  // --critical
  'rgba(255,159,28,ALPHA)',  // --warning   (farthest / tail)
];

// Bold solid dart/kite silhouette (4 points, one concave notch) — tip
// top-left, wide point right, pulled-in notch, tail point below.
const POINTER_PATH: [number, number][] = [
  [0, 0], [30, 20], [12, 24], [16, 42],
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
// Each echo lags further behind the one in front of it — lower factor = more lag.
const LERP_FACTORS = [0.32, 0.24, 0.18, 0.13];
const SCALES = [1.0, 0.88, 0.76, 0.64];
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
    if (reduced) return; // native pointer only, no trail — respects the setting

    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const onResize = () => { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; };
    window.addEventListener('resize', onResize);

    const onMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      if (!mouseRef.current.active) {
        // First-ever move: snap all echoes straight to the cursor instead of
        // sliding in from (-9999,-9999) across the whole screen.
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
        // Chain-follow: echo[0] lerps toward the cursor, echo[1] lerps
        // toward echo[0]'s position, echo[2] toward echo[1], etc. — a
        // "snake" with 4 fixed links, never more, never fewer.
        const echoes = echoesRef.current;
        let targetX = x, targetY = y;
        for (let i = 0; i < ECHO_COUNT; i++) {
          const ec = echoes[i];
          ec.x += (targetX - ec.x) * LERP_FACTORS[i];
          ec.y += (targetY - ec.y) * LERP_FACTORS[i];
          targetX = ec.x; targetY = ec.y;
        }
      }

      // ── Magnetic hover: all DOM reads/writes gated to once per frame ──
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

      // ── Draw exactly 4 echoes, tail-to-head so the nearest one sits on top ──
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
