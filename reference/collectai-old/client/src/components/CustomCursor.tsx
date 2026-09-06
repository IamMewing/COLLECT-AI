import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export const CustomCursor: React.FC = () => {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const breathingRef = useRef<gsap.core.Tween | null>(null);
  const isHovering = useRef(false);

  // Detect touch/mobile — disable cursor entirely
  const isMobile =
    typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

  // Detect reduced-motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (isMobile || prefersReducedMotion) return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    // Hide the system cursor
    document.documentElement.style.cursor = 'none';

    // GPU-accelerate both elements
    gsap.set([dot, ring], { willChange: 'transform', force3D: true });

    // Subtle idle breathing on the ring — opacity only, no scale (scale causes the click-ring look)
    breathingRef.current = gsap.to(ring, {
      opacity: 0.5,
      duration: 1.6,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
    });

    const onMouseMove = (e: MouseEvent) => {
      // Dot snaps instantly — 1 frame
      gsap.to(dot, {
        x: e.clientX,
        y: e.clientY,
        duration: 0.0,
        overwrite: 'auto',
      });

      // Ring follows with smooth lag
      gsap.to(ring, {
        x: e.clientX,
        y: e.clientY,
        duration: 0.28,
        ease: 'power3.out',
        overwrite: 'auto',
      });
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const clickable =
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.closest('button') ||
        target.closest('a') ||
        target.closest('[role="button"]') ||
        target.classList.contains('interactive') ||
        target.closest('.interactive');

      if (clickable && !isHovering.current) {
        isHovering.current = true;
        // Pause breathing, scale up ring for hover state
        breathingRef.current?.pause();
        gsap.to(ring, { scale: 1.7, duration: 0.2, ease: 'power2.out' });
        gsap.to(dot, { scale: 1.5, duration: 0.2, ease: 'power2.out' });
      } else if (!clickable && isHovering.current) {
        isHovering.current = false;
        gsap.to(dot, { scale: 1, duration: 0.2, ease: 'power2.out' });
        // Resume breathing from scale 1
        gsap.to(ring, {
          scale: 1,
          duration: 0.2,
          ease: 'power2.out',
          onComplete: () => {
            breathingRef.current?.resume();
          },
        });
      }
    };

    const onMouseLeave = () => {
      gsap.to([dot, ring], { opacity: 0, duration: 0.2 });
    };

    const onMouseEnter = () => {
      gsap.to([dot, ring], { opacity: 1, duration: 0.2 });
    };

    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseover', onMouseOver, { passive: true });
    document.documentElement.addEventListener('mouseleave', onMouseLeave);
    document.documentElement.addEventListener('mouseenter', onMouseEnter);

    return () => {
      document.documentElement.style.cursor = '';
      breathingRef.current?.kill();
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseover', onMouseOver);
      document.documentElement.removeEventListener('mouseleave', onMouseLeave);
      document.documentElement.removeEventListener('mouseenter', onMouseEnter);
    };
  }, [isMobile, prefersReducedMotion]);

  if (isMobile || prefersReducedMotion) return null;

  return (
    <>
      {/* Core dot — snaps to cursor instantly */}
      <div
        ref={dotRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '6px',
          height: '6px',
          marginLeft: '-3px',
          marginTop: '-3px',
          backgroundColor: 'var(--ink)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 2147483647,
          willChange: 'transform',
        }}
      />

      {/* Outer follower ring — trails the dot */}
      <div
        ref={ringRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '26px',
          height: '26px',
          marginLeft: '-13px',
          marginTop: '-13px',
          border: '1.5px solid rgba(10, 10, 10, 0.3)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 2147483646,
          willChange: 'transform',
          opacity: 0.6,
        }}
      />
    </>
  );
};

export default CustomCursor;
