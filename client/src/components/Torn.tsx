import React, { useEffect, useRef } from 'react';

type Tone = 'acid' | 'ink' | 'bone';

const HEX: Record<Tone, string> = {
  acid: '#FFE500',
  ink: '#000000',
  bone: '#F2EFE4',
};

const W = 1200;
const H = 120;
const STEPS = 44;

/**
 * The boundary between two colour fields, as a wave that actually moves.
 *
 * The edge is three sine components at different wavelengths summed together,
 * which is enough to stop it reading as a single clean ripple — the long one
 * carries the shape, the short ones rough it up. Their phase is driven by
 * scroll position, so the surface travels as the page moves, and by a slow
 * clock so it is never frozen when the page is still.
 *
 * Scroll *velocity* feeds the amplitude as well: throw the page and the waves
 * swell, stop and they settle back over about a second. That is the part that
 * makes it feel like liquid being disturbed rather than a looping decoration.
 */

/** Sample the surface, then stitch the samples with quadratics through their
 *  midpoints — a polyline this coarse would show its facets. */
const buildPath = (phase: number, amp: number, seed: number) => {
  const ys: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const x = (i / STEPS) * W;
    ys.push(
      H * 0.5 +
        amp *
          (1.0 * Math.sin(x * 0.0061 + phase * 1.00 + seed) +
            0.56 * Math.sin(x * 0.0117 - phase * 1.43 + seed * 2.1) +
            0.3 * Math.sin(x * 0.0223 + phase * 0.81 + seed * 3.7))
    );
  }

  let d = `M0,${ys[0].toFixed(2)}`;
  for (let i = 1; i < STEPS; i++) {
    const x = (i / STEPS) * W;
    const nx = ((i + 1) / STEPS) * W;
    d += ` Q${x.toFixed(2)},${ys[i].toFixed(2)} ${((x + nx) / 2).toFixed(2)},${(
      (ys[i] + ys[i + 1]) / 2
    ).toFixed(2)}`;
  }
  d += ` L${W},${ys[STEPS].toFixed(2)} L${W},${H} L0,${H} Z`;
  return d;
};

interface TornProps {
  from: Tone;
  to: Tone;
  /** Shifts the wave so neighbouring dividers don't march in lockstep. */
  variant?: 0 | 1 | 2;
}

export const Torn: React.FC<TornProps> = ({ from, to, variant = 0 }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const host = hostRef.current;
    if (!path || !host) return;

    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    const seed = variant * 2.4;
    const BASE_AMP = 17;

    if (reduced) {
      path.setAttribute('d', buildPath(seed, BASE_AMP, seed));
      return;
    }

    let scrollPhase = window.scrollY * 0.0042;
    let lastY = window.scrollY;
    let surge = 0; // scroll-velocity energy, decays to zero
    let raf = 0;
    let visible = true;
    const t0 = performance.now();

    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      lastY = y;
      scrollPhase = y * 0.0042;
      surge = Math.min(1, surge + Math.abs(dy) * 0.012);
    };

    // A divider parked off-screen has nothing to say; stop drawing it.
    const io = new IntersectionObserver(
      ([e]) => {
        visible = e.isIntersecting;
      },
      { rootMargin: '140px 0px' }
    );
    io.observe(host);

    let prev = t0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      surge *= Math.pow(0.12, dt); // ~1s to settle
      if (!visible) return;

      const t = (now - t0) / 1000;
      const phase = scrollPhase + t * 0.17 + seed;
      path.setAttribute('d', buildPath(phase, BASE_AMP * (1 + surge * 0.85), seed));
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [variant]);

  return (
    <div ref={hostRef} className="torn" style={{ background: HEX[from] }} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path ref={pathRef} fill={HEX[to]} d={buildPath(variant * 2.4, 17, variant * 2.4)} />
      </svg>
    </div>
  );
};

export default Torn;
