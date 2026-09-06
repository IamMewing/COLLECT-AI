import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { TopNav } from './TopNav';
import { CustomCursor } from './CustomCursor';
import { AgentThinkingOverlay } from './AgentThinkingOverlay';
import { useStore } from '../store/useStore';
import { useAgentUI } from '../store/useAgentUI';
import { CommandBar } from './CommandBar';
import { GcpBackground } from './GcpBackground';
import { Copilot } from './Copilot';
import { ProductTour } from './ProductTour';

export const Layout: React.FC = () => {
  const fetchBusinesses = useStore((state) => state.fetchBusinesses);
  const loadAllData = useStore((state) => state.loadAllData);
  const toasts = useStore((state) => state.toasts);
  const removeToast = useStore((state) => state.removeToast);
  const tourActive = useStore((state) => state.tourActive);
  const endTour = useStore((state) => state.endTour);

  // Activate Agent UI automation (navigation, highlights, scroll, animations)
  useAgentUI();

  useEffect(() => {
    fetchBusinesses().then(() => {
      loadAllData();
    });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%' }}>
      <CustomCursor />
      <GcpBackground />
      <AgentThinkingOverlay />
      <CommandBar />

      {/* Copilot / AI Employee — the floating orb has data-tour-id="tour-ai-employee" */}
      <Copilot />

      <TopNav />

      <main className="page-container" style={{ flex: 1 }}>
        <Outlet />
      </main>

      {/* Toast Notifications */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'center'
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            style={{
              padding: '10px 20px',
              backgroundColor: t.type === 'success' ? 'var(--ink)' : t.type === 'error' ? 'var(--red)' : 'var(--ink)',
              color: t.type === 'success' ? 'var(--yellow)' : 'var(--white)',
              border: 'var(--stroke)',
              borderRadius: '4px',
              boxShadow: 'var(--shadow-lg)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-label)',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              maxWidth: '500px'
            }}
          >
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Product Tour — mounted here so it survives route changes during multi-page tour */}
      {tourActive && <ProductTour onEnd={endTour} />}
    </div>
  );
};
