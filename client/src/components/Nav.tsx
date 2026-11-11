import React, { useEffect, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Bell } from 'lucide-react';

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

const LINKS = [
  { to: '/agent', label: 'Agent' },
  { to: '/ledger', label: 'Ledger' },
  { to: '/negotiations', label: 'Negotiations' },
  { to: '/history', label: 'History' },
];

/**
 * Sticky nav that recolours itself from whichever field is currently behind
 * it, so it stays legible across the mint/ink/coral pages without carrying
 * its own background plate. The recolouring predates routing and still
 * earns its keep: every page is built out of the same `[data-field]`
 * sections, and the landing page stacks several of them in one scroll.
 */
export const Nav: React.FC<{ unreadCount?: number }> = ({ unreadCount = 0 }) => {
  const [on, setOn] = useState<'ultra' | 'ink' | 'lime'>('ultra');

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
          setOn((el.dataset.field as 'ultra' | 'ink' | 'lime') ?? 'ultra');
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
    // Routing changes which field sits under the nav without any scroll
    // event firing, so re-probe on the next frame after every navigation.
    const settle = requestAnimationFrame(read);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(settle);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  });

  return (
    <nav className="nav" data-on={on}>
      <Link className="brand" to="/">
        <Mark />
        CollectAI
      </Link>
      <div className="nav-links">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => `pill pill--sm${isActive ? ' pill--solid' : ''}`}
          >
            {l.label}
          </NavLink>
        ))}
        {/* The badge sits OUTSIDE the pill, not inside it: .pill clips its
            own children (overflow:hidden, for the slide-up fill on hover),
            which lopped the corner off a badge positioned within it. */}
        <span className="nav-bell-wrap">
          <NavLink
            to="/notifications"
            aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            className={({ isActive }) => `pill pill--sm pill--icon${isActive ? ' pill--solid' : ''}`}
          >
            <Bell size={15} />
          </NavLink>
          {unreadCount > 0 && (
            <span className="nav-bell-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </span>
      </div>
    </nav>
  );
};

export default Nav;
