import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../contexts/AuthContext';
import gsap from 'gsap';

export const TopNav: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const selectedBusinessId = useStore((s) => s.selectedBusinessId);
  const businesses = useStore((s) => s.businesses);
  const setSelectedBusinessId = useStore((s) => s.setSelectedBusinessId);

  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [imgError, setImgError] = useState(false);

  const activeBusiness = businesses.find(b => b.business_id === selectedBusinessId);
  const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.email || 'default'}`;
  const userAvatar = user?.photoURL || defaultAvatar;

  // Close menu on click outside
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Animate menu in
  useEffect(() => {
    if (showUserMenu && menuRef.current) {
      gsap.fromTo(menuRef.current,
        { opacity: 0, y: -6 },
        { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' }
      );
    }
  }, [showUserMenu]);

  const navItems = [
    { to: '/', label: 'Mission', tourId: 'tour-dashboard' },
    { to: '/clients', label: 'Clients', tourId: 'tour-clients' },
    { to: '/collections', label: 'Collections', tourId: 'tour-collections' },
    { to: '/timeline', label: 'Timeline', tourId: 'tour-timeline' },
    { to: '/insights', label: 'Insights', tourId: 'tour-insights' },
    { to: '/settings', label: 'Settings', tourId: 'tour-settings' },
  ];

  return (
    <nav className="top-nav">
      {/* Brand */}
      <div
        className="top-nav-brand"
        onClick={() => navigate('/')}
        style={{ cursor: 'pointer' }}
      >
        <div className="top-nav-brand-mark">
          {activeBusiness?.name?.substring(0, 2).toUpperCase() || 'CA'}
        </div>
        <span className="top-nav-brand-name">
          CollectAI
        </span>
        {activeBusiness && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-label)',
            color: 'var(--muted)',
            marginLeft: '4px'
          }}>
            / {activeBusiness.name}
          </span>
        )}
      </div>

      {/* Navigation Links */}
      <div className="top-nav-links">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            data-tour-id={item.tourId}
            className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Right Actions */}
      <div className="top-nav-actions">
        {/* Create Invoice button shortcut */}
        <button
          onClick={() => navigate('/add')}
          className="nav-icon-btn"
          title="Create Invoice"
          data-tour-id="tour-add-invoice"
          style={{
            fontSize: '1rem',
            fontWeight: 'bold',
            background: 'var(--yellow-soft)',
            border: '1.5px solid var(--border)',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            boxShadow: '1px 1px 0 var(--border)',
          }}
        >
          +
        </button>

        {/* Keyboard shortcut hint */}
        <button
          className="nav-icon-btn"
          title="Command Bar (Ctrl+K)"
          style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}
        >
          ⌘K
        </button>

        {/* AI Status Indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-label)',
          color: 'var(--muted)'
        }}>
          <span style={{
            width: '6px', height: '6px',
            borderRadius: '50%',
            background: 'var(--mint)',
            border: '1px solid #1a7f4b',
            display: 'inline-block'
          }} />
          AI Active
        </div>

        {/* User Avatar + Dropdown */}
        <div style={{ position: 'relative' }}>
          <img
            src={imgError ? defaultAvatar : userAvatar}
            alt="user"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="top-nav-avatar"
            onClick={() => setShowUserMenu(!showUserMenu)}
          />

          {showUserMenu && (
            <div
              ref={menuRef}
              style={{
                position: 'absolute',
                top: '42px',
                right: 0,
                width: '260px',
                background: 'var(--white)',
                border: 'var(--stroke)',
                boxShadow: 'var(--shadow-lg)',
                borderRadius: '4px',
                padding: '8px 0',
                zIndex: 999
              }}
            >
              {/* User Info */}
              <div style={{
                padding: '12px 16px',
                borderBottom: 'var(--stroke-subtle)'
              }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-caption)' }}>
                  {user?.displayName || user?.email?.split('@')[0]}
                </div>
                <div style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', marginTop: '2px' }}>
                  {user?.email}
                </div>
              </div>

              {/* Workspace Switch */}
              {businesses.length > 1 && (
                <div style={{ padding: '8px 16px', borderBottom: 'var(--stroke-subtle)' }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-label)',
                    color: 'var(--muted)',
                    marginBottom: '6px'
                  }}>
                    WORKSPACE
                  </div>
                  {businesses.map(b => (
                    <div
                      key={b.business_id}
                      onClick={() => {
                        setSelectedBusinessId(b.business_id);
                        setShowUserMenu(false);
                      }}
                      style={{
                        padding: '6px 8px',
                        fontSize: 'var(--text-caption)',
                        cursor: 'pointer',
                        borderRadius: '2px',
                        background: b.business_id === selectedBusinessId ? 'var(--yellow-soft)' : 'transparent',
                        fontWeight: b.business_id === selectedBusinessId ? 600 : 400,
                        transition: 'background 0.15s'
                      }}
                    >
                      {b.name}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div style={{ padding: '4px 8px' }}>
                <div
                  onClick={() => { navigate('/settings'); setShowUserMenu(false); }}
                  style={{
                    padding: '8px',
                    fontSize: 'var(--text-caption)',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper-warm)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Settings
                </div>
                <div
                  onClick={() => { navigate('/add'); setShowUserMenu(false); }}
                  style={{
                    padding: '8px',
                    fontSize: 'var(--text-caption)',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--paper-warm)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Create Invoice
                </div>
                <div
                  onClick={() => logout()}
                  style={{
                    padding: '8px',
                    fontSize: 'var(--text-caption)',
                    color: 'var(--red)',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    transition: 'background 0.15s'
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  Sign Out
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};
