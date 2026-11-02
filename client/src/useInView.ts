import { useEffect, useRef, useState } from 'react';

/**
 * Adds `is-in` once the element first scrolls into view, then stops observing.
 * Reveals fire once — re-animating on every scroll-by is the tell of a
 * generic page, and it makes long pages feel twitchy.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  threshold = 0.18
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return [ref, inView];
}
