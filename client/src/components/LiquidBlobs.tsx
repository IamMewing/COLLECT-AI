import React, { useEffect, useRef } from 'react';

/**
 * The signature move.
 *
 * A chain of circles trails the pointer with increasing lag and runs through
 * an SVG gaussian-blur + alpha-contrast filter, so they fuse into one liquid
 * mass instead of reading as separate dots. The layer is filled yellow and
 * composited with `mix-blend-mode: difference`:
 *
 *   yellow blob over the yellow field  -> black  (the ink spreads)
 *   yellow blob over black type        -> yellow (the type knocks out)
 *
 * which means the exact same layer inverts correctly over the ink fields too,
 * with no per-section configuration.
 *
 * With no pointer (touch, or someone who hasn't moved yet) the chain drifts
 * along a slow lissajous path so the hero is never dead.
 */

const BLOBS = [
  { r: 86, lag: 0.085 },
  { r: 68, lag: 0.062 },
  { r: 52, lag: 0.046 },
  { r: 38, lag: 0.034 },
  { r: 26, lag: 0.025 },
];

export const LiquidBlobs: React.FC<{ className?: string }> = ({ className }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const circleRefs = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    if (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    let w = host.clientWidth;
    let h = host.clientHeight;

    // Chain positions, seeded centre-ish so the first frame isn't a corner pile.
    const pts = BLOBS.map(() => ({ x: w * 0.5, y: h * 0.4 }));
    const target = { x: w * 0.5, y: h * 0.4 };

    let pointerSeen = false;
    let lastMove = 0;
    let raf = 0;
    const t0 = performance.now();

    /** Narrow viewports get proportionally smaller blobs, or one blob swallows
     *  the whole headline and the body copy underneath it. */
    const sizeBlobs = () => {
      const k = Math.max(0.4, Math.min(1, w / 1200));
      BLOBS.forEach((b, i) => {
        circleRefs.current[i]?.setAttribute('r', String(Math.round(b.r * k)));
      });
    };

    const onResize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      sizeBlobs();
    };
    sizeBlobs();

    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      target.x = e.clientX - rect.left;
      target.y = e.clientY - rect.top;
      pointerSeen = true;
      lastMove = performance.now();
    };

    const tick = (now: number) => {
      // Fall back to a drift when the pointer has gone quiet for a beat. The
      // drift is kept in the upper band, where the headline is — left to roam
      // it parks itself on top of the body copy, which just reads as a bug.
      const idle = !pointerSeen || now - lastMove > 2200;
      if (idle) {
        const t = (now - t0) / 1000;
        target.x = w * (0.52 + 0.3 * Math.sin(t * 0.34));
        target.y = h * (0.33 + 0.14 * Math.sin(t * 0.47 + 1.1));
      }

      let px = target.x;
      let py = target.y;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        p.x += (px - p.x) * (BLOBS[i].lag * 7);
        p.y += (py - p.y) * (BLOBS[i].lag * 7);
        const c = circleRefs.current[i];
        if (c) {
          c.setAttribute('cx', p.x.toFixed(1));
          c.setAttribute('cy', p.y.toFixed(1));
        }
        px = p.x;
        py = p.y;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div ref={hostRef} className={className ?? 'blobs'} aria-hidden="true">
      <svg width="100%" height="100%">
        {BLOBS.map((b, i) => (
          <circle
            key={i}
            ref={(el) => {
              circleRefs.current[i] = el;
            }}
            r={b.r}
            cx="-999"
            cy="-999"
          />
        ))}
      </svg>
    </div>
  );
};

/** The gooey filter itself — mounted once, near the root. */
export const GooFilter: React.FC = () => (
  <svg
    aria-hidden="true"
    focusable="false"
    style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
  >
    <defs>
      <filter id="goo" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="blur" />
        <feColorMatrix
          in="blur"
          mode="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"
        />
      </filter>
    </defs>
  </svg>
);

export default LiquidBlobs;
