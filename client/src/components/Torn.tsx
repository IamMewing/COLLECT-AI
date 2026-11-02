import React, { useEffect, useRef } from 'react';
import { W, H, STEPS, OVER, waveVbY, waveRegistry } from './tornWave';

type Tone = 'lime' | 'ember' | 'lilac';

const HEX: Record<Tone, string> = {
  lime: '#D4FF3F',
  ember: '#E34234',
  lilac: '#CBB3E8',
};

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
    ys.push(waveVbY((i / STEPS) * W, phase, amp, seed));
  }

  let d = `M0,${ys[0].toFixed(2)}`;
  for (let i = 1; i < STEPS; i++) {
    const x = (i / STEPS) * W;
    const nx = ((i + 1) / STEPS) * W;
    d += ` Q${x.toFixed(2)},${ys[i].toFixed(2)} ${((x + nx) / 2).toFixed(2)},${(
      (ys[i] + ys[i + 1]) / 2
    ).toFixed(2)}`;
  }
  // Closes UPWARD, past the top of the viewBox. The element's own background is
  // the colour of the field below, so the fill painted here is the field above.
  // Done the other way round, the element's bottom row is a half-covered edge
  // of the lower fill with the upper colour behind it, and subpixel rounding
  // turns that into a hairline of the wrong colour straight across the page —
  // visible or not depending on where the divider happens to land.
  d += ` L${W},${ys[STEPS].toFixed(2)} L${W},${-OVER} L0,${-OVER} Z`;
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
      waveRegistry.set(host, { phase: seed, amp: BASE_AMP, seed });
      return () => {
        waveRegistry.delete(host);
      };
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
      const amp = BASE_AMP * (1 + surge * 0.85);
      path.setAttribute('d', buildPath(phase, amp, seed));
      // Publish it: the cursor mass splits its fill along this exact curve.
      waveRegistry.set(host, { phase, amp, seed });
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      waveRegistry.delete(host);
    };
  }, [variant]);

  return (
    <div
      ref={hostRef}
      className="torn"
      style={{ background: HEX[to] }}
      data-from={from}
      data-to={to}
      aria-hidden="true"
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path ref={pathRef} fill={HEX[from]} d={buildPath(variant * 2.4, 17, variant * 2.4)} />
      </svg>
    </div>
  );
};

export default Torn;
