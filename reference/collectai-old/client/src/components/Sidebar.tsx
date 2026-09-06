import React from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../contexts/AuthContext';
import { CustomSelect } from './CustomSelect';

export const Sidebar: React.FC = () => {
  const { user, logout } = useAuth();
  const selectedBusinessId = useStore((state) => state.selectedBusinessId);
  const businesses = useStore((state) => state.businesses);
  const setSelectedBusinessId = useStore((state) => state.setSelectedBusinessId);

  const [imgError, setImgError] = React.useState(false);

  const activeBusiness = businesses.find(b => b.business_id === selectedBusinessId);
  const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${user?.email || 'default'}`;
  const userAvatar = user?.photoURL || defaultAvatar;

  return (
    <aside 
      className="sidebar"
      style={{
        width: '270px',
        backgroundColor: 'var(--paper-warm)',
        borderRight: 'var(--stroke-thick)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 100
      }}
    >
      {/* Brand logo details */}
      <div 
        className="sidebar-brand"
        style={{
          padding: '20px 24px',
          background: 'var(--yellow)',
          borderBottom: 'var(--stroke-thick)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <div 
          style={{
            width: '40px',
            height: '40px',
            background: 'var(--white)',
            border: 'var(--stroke)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-display)',
            fontSize: '1.25rem',
            fontWeight: 800
          }}
        >
          {activeBusiness?.name?.substring(0, 2).toUpperCase() || 'CA'}
        </div>
        
        <div>
          <h1 
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.15rem',
              fontWeight: 800,
              color: 'var(--ink)',
              letterSpacing: '-0.02em',
              textTransform: 'uppercase',
              lineHeight: 1.1
            }}
          >
            {activeBusiness?.name || 'CollectAI'}
          </h1>
          <span 
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.62rem',
              fontWeight: 700,
              color: 'var(--ink)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}
          >
            PLAN: AI PARTNER
          </span>
        </div>
      </div>

      {businesses.length > 0 && (
        <div 
          style={{
            padding: '12px 20px',
            borderBottom: 'var(--stroke)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <CustomSelect 
            label="SWITCH STUDIO"
            value={selectedBusinessId || ''}
            onChange={(val) => setSelectedBusinessId(val || null)}
            placeholder="Select studio profile..."
            options={businesses.map(b => ({
              value: b.business_id,
              label: b.name,
              description: `Switch active workspace profile: ${b.owner_email}`
            }))}
          />
        </div>
      )}

      {/* Navigation */}
      <nav 
        className="sidebar-nav"
        style={{
          flex: 1,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}
      >
        <NavLink 
          to="/" 
          end
          data-tour-id="tour-dashboard"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">📊</span> Mission Control
        </NavLink>
        <NavLink 
          to="/collections"
          data-tour-id="tour-collections"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">📋</span> Collections
        </NavLink>
        <NavLink 
          to="/clients"
          data-tour-id="tour-clients"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">👤</span> Clients
        </NavLink>
        <NavLink 
          to="/timeline"
          data-tour-id="tour-timeline"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">📓</span> Timeline
        </NavLink>
        <NavLink 
          to="/add"
          data-tour-id="tour-add-invoice"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">⚡</span> New Invoice
        </NavLink>
        <NavLink 
          to="/settings"
          data-tour-id="tour-settings"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">⚙️</span> Settings
        </NavLink>
        <NavLink 
          to="/insights"
          data-tour-id="tour-insights"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ padding: '10px 14px', fontSize: '0.88rem' }}
        >
          <span className="nav-icon">📈</span> Insights
        </NavLink>
      </nav>

      {/* Footer Metrics & Auth */}
      <div 
        style={{
          padding: '16px',
          background: 'var(--paper-warm)',
          borderTop: 'var(--stroke)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {/* Storage, Agent Status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>STORAGE USED:</span>
            <span style={{ fontWeight: 'bold' }}>0.8 MB // 100 MB</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>AI AGENT:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span 
                style={{ 
                  width: '6px', 
                  height: '6px', 
                  backgroundColor: 'var(--mint)', 
                  display: 'inline-block' 
                }} 
              />
              <span style={{ fontWeight: 'bold', color: 'var(--ink)' }}>ACTIVE</span>
            </div>
          </div>
        </div>

        {/* User Card */}
        <div 
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <img 
              src={imgError ? defaultAvatar : userAvatar} 
              alt="user avatar"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              style={{
                width: '32px',
                height: '32px',
                border: 'var(--stroke)',
                backgroundColor: 'var(--white)'
              }}
            />
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {user?.displayName || user?.email?.split('@')[0]}
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--muted)', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {user?.email}
              </div>
            </div>
          </div>

          <button 
            onClick={() => logout()}
            style={{
              padding: '4px 8px',
              fontSize: '0.65rem',
              boxShadow: '1px 1px 0 var(--ink)',
              borderWidth: '1.5px',
              background: 'var(--white)'
            }}
          >
            OUT
          </button>
        </div>
      </div>
    </aside>
  );
};
