import React, { useEffect, useState } from 'react';

const Mark: React.FC = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M16 0a16 16 0 1 1 0 32 16 16 0 0 1 0-32Zm0 7.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z"
    />
    <rect x="13.9" y="0" width="4.2" height="11" fill="currentColor" />
  </svg>
);

/**
 * Sticky nav that recolours itself from whichever field is currently behind
 * it, so it stays legible across the mint/ink/coral sections without
 * carrying its own background plate.
 */
export const Nav: React.FC = () => {
  const [on, setOn] = useState<'mint' | 'ink' | 'coral'>('mint');

  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const probe = 34; // just under the nav's own centre line
      const fields = Array.from(
        document.querySelectorAll<HTMLElement>('[data-field]')
      );
      for (const el of fields) {
        const r = el.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) {
          setOn((el.dataset.field as 'mint' | 'ink' | 'coral') ?? 'mint');
          return;
        }
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="nav" data-on={on}>
      <a className="brand" href="#top" onClick={go('top')}>
        <Mark />
        CollectAI
      </a>
      <div className="nav-links">
        <a className="pill pill--sm" href="#agent" onClick={go('agent')}>
          The agent
        </a>
        <a className="pill pill--sm" href="#ledger" onClick={go('ledger')}>
          Ledger
        </a>
        <a className="pill pill--sm" href="#decision" onClick={go('decision')}>
          Your call
        </a>
      </div>
    </nav>
  );
};

export default Nav;
