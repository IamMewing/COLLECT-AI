import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { fetchAuthStatus } from './api';
import { PasswordGate } from './components/PasswordGate';
import { Boot } from './components/Boot';
import { AppStateProvider } from './AppState';
import { NotificationsProvider } from './notifications';
import { AppLayout } from './layouts/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { AgentPage } from './pages/AgentPage';
import { LedgerPage } from './pages/LedgerPage';
import { HistoryPage } from './pages/HistoryPage';
import { NegotiationsPage } from './pages/NegotiationsPage';
import { NotificationsPage } from './pages/NotificationsPage';

export const App: React.FC = () => {
  // 'checking' avoids a flash of either the lock screen or the real app
  // before we know which one is correct. If the status check itself fails
  // (server unreachable), falls open to 'unlocked' — a password gate that's
  // down shouldn't also take the whole demo down with it; the actual data
  // is still protected server-side by auth.requireAuth regardless.
  const [authState, setAuthState] = useState<'checking' | 'locked' | 'unlocked'>('checking');

  useEffect(() => {
    fetchAuthStatus()
      .then((s) => setAuthState(!s.required || s.authenticated ? 'unlocked' : 'locked'))
      .catch(() => setAuthState('unlocked'));
  }, []);

  if (authState === 'checking') {
    // Deliberately blank rather than a spinner — this resolves in one fast
    // same-origin request, and a spinner that appears for a few dozen
    // milliseconds reads as more of a flash than a loading state.
    return <div className="field--ink" style={{ position: 'fixed', inset: 0 }} />;
  }

  if (authState === 'locked') {
    return <PasswordGate onUnlocked={() => setAuthState('unlocked')} />;
  }

  return (
    <BrowserRouter>
      <Boot />
      <NotificationsProvider>
        {/* Inside the router, because navigating is part of what this state
            does — running the agent takes you to /agent. */}
        <AppStateProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<LandingPage />} />
              <Route path="/agent" element={<AgentPage />} />
              <Route path="/ledger" element={<LedgerPage />} />
              <Route path="/negotiations" element={<NegotiationsPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AppStateProvider>
      </NotificationsProvider>
    </BrowserRouter>
  );
};

export default App;
