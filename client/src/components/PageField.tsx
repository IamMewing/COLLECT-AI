import React, { useEffect, useState } from 'react';

export type Tone = 'ultra' | 'ink' | 'lime';

/**
 * A full-bleed colour field for a routed page.
 *
 * The landing page's <Field> reveals itself when scrolled into view, which is
 * right for a long editorial scroll but wrong here: you arrive on /ledger
 * already looking at it, and content gated behind an IntersectionObserver
 * that may never fire (short page, no scroll) would simply stay invisible —
 * `.fade` children sit at opacity 0 until an `is-in` ancestor appears. So
 * this reveals on mount instead, one frame late so the entrance still
 * animates rather than snapping in.
 */
export const PageField: React.FC<{
  id?: string;
  tone: Tone;
  marker?: string;
  statement?: string;
  aside?: React.ReactNode;
  tight?: boolean;
  children: React.ReactNode;
}> = ({ id, tone, marker, statement, aside, tight, children }) => {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section
      id={id}
      data-field={tone}
      className={`field field--${tone}${tight ? ' field--tight' : ''}${shown ? ' is-in' : ''}`}
    >
      <div className="wrap">
        {(marker || statement || aside) && (
          <header className="page-head">
            <div>
              {marker && <span className="marker fade">{marker}</span>}
              {statement && <h1 className="statement rise rise--1"><span>{statement}</span></h1>}
            </div>
            {aside && <div className="fade">{aside}</div>}
          </header>
        )}
        <div className="fade">{children}</div>
      </div>
    </section>
  );
};

export default PageField;
