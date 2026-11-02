import React, { useEffect, useState } from 'react';

/**
 * The single page-load moment: a dot that swells, hesitates, then floods the
 * screen yellow and hands over to the hero. Unmounts itself so nothing is
 * left sitting on top of the page intercepting anything.
 */
export const Boot: React.FC = () => {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setGone(true), reduced ? 0 : 1900);
    return () => clearTimeout(t);
  }, []);

  if (gone) return null;
  return (
    <div className="boot" aria-hidden="true">
      <div className="boot-dot" />
    </div>
  );
};

export default Boot;
