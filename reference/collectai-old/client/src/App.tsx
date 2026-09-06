import React, { useEffect, useState, useCallback } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { db } from './firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { useStore } from './store/useStore';

// ─── Page Imports ─────────────────────────────────────────────────────────────
import { Landing }             from './pages/Landing';
import { Login }               from './pages/Login';
import { Onboarding }          from './pages/Onboarding';
import { InitializeWorkspace } from './pages/InitializeWorkspace';
import { WelcomeScreen }       from './pages/WelcomeScreen';
import { DashboardLoader }     from './pages/DashboardLoader';
import { ResetPassword }       from './pages/ResetPassword';
import { Layout }              from './components/Layout';
import { Dashboard }           from './pages/Dashboard';
import { ClientProfiles }      from './pages/ClientProfiles';
import { ReflectionJournal }   from './pages/ReflectionJournal';
import { Pipeline }            from './pages/Pipeline';
import { AddInvoice }          from './pages/AddInvoice';
import { Settings }            from './pages/Settings';
import { Insights }            from './pages/Insights';

// ─── Auth Loading Screen ──────────────────────────────────────────────────────

const AuthLoading: React.FC = () => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', backgroundColor: 'var(--paper)',
    flexDirection: 'column', gap: '16px',
  }}>
    <div style={{
      width: '36px', height: '36px',
      border: '3px solid var(--border)',
      borderTopColor: 'var(--yellow)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      color: 'var(--muted)',
    }}>
      Connecting to workspace...
    </span>
  </div>
);

// ─── Flow state ──────────────────────────────────────────────────────────────

type FlowState = 'checking' | 'onboarding' | 'initialize' | 'tour' | 'dashboard';

// ─── Auth Guard ───────────────────────────────────────────────────────────────
// Runs checkFlowState ONLY when user identity changes (not on every navigation).
// Uses sessionStorage as a fast-path override for the stale-Firestore window.

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const [flowState, setFlowState] = useState<FlowState>('checking');

  // Exempt paths
  const isOnboarding = location.pathname === '/onboarding';
  const isInitialize = location.pathname === '/initialize';
  const isWelcome    = location.pathname === '/welcome';
  const isLoader     = location.pathname === '/loading';

  const checkFlowState = useCallback(async (uid: string) => {
    const sessionOnboarded = sessionStorage.getItem('onboardingCompleted') === uid;
    const sessionInitialized = sessionStorage.getItem('workspaceInitialized') === uid;
    const sessionTourDone = sessionStorage.getItem('tourCompleted') === uid;

    // Fast-path: if all completed in session, go directly to dashboard without waiting
    if (sessionOnboarded && sessionInitialized && sessionTourDone) {
      setFlowState('dashboard');
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) {
        const data = snap.data();
        const hasOnboarded = data.onboardingCompleted === true || sessionOnboarded;
        const hasInitialized = data.workspaceInitialized === true || sessionInitialized;
        const hasCompletedTour = data.tourCompleted === true || sessionTourDone;

        if (!hasOnboarded) {
          setFlowState('onboarding');
        } else if (!hasInitialized) {
          setFlowState('initialize');
        } else if (!hasCompletedTour) {
          setFlowState('tour');
        } else {
          setFlowState('dashboard');
        }
      } else {
        if (sessionOnboarded) {
          setFlowState(sessionInitialized ? (sessionTourDone ? 'dashboard' : 'tour') : 'initialize');
        } else {
          setFlowState('onboarding');
        }
      }
    } catch (err: any) {
      console.warn('⚠️ checkFlowState failed:', err.message);
      if (sessionOnboarded) {
        setFlowState('dashboard');
      } else {
        setFlowState('onboarding');
      }
    }
  }, []);

  // Only re-check when the authenticated user identity changes — NOT on every route navigation.
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      checkFlowState(user.uid);
    } else {
      setFlowState('checking');
    }
  }, [user, authLoading, checkFlowState]);

  // 1. Auth still resolving
  if (authLoading) return <AuthLoading />;

  // 2. Not logged in
  if (!user) return <Navigate to="/landing" replace />;

  // 3. Checking Firestore workspace state
  if (flowState === 'checking') return <AuthLoading />;

  // 4. Redirections based on flowState

  if (flowState === 'onboarding') {
    if (!isOnboarding) return <Navigate to="/onboarding" replace />;
  }

  if (flowState === 'initialize') {
    if (!isInitialize) return <Navigate to="/initialize" replace />;
  }

  // Tour state: allow /welcome (pre-tour) or any app route (tour is mounted in Layout).
  // If sessionStorage flag is set, treat as dashboard even if Firestore hasn't propagated yet.
  const tourJustCompleted = sessionStorage.getItem('tourCompleted') === user.uid;

  if (flowState === 'tour' && !tourJustCompleted) {
    // Only block if they haven't completed tour and are not on /welcome
    if (!isWelcome) {
      return <Navigate to="/welcome" replace />;
    }
  }

  if (flowState === 'dashboard' || tourJustCompleted) {
    if (isOnboarding || isInitialize || isWelcome) {
      return <Navigate to="/" replace />;
    }
    // Loading screen check only when businesses haven't loaded
    const hasLoaded = useStore.getState().businesses.length > 0;
    if (!hasLoaded && !isLoader) {
      return <Navigate to="/loading" replace />;
    }
  }

  // 5. Render child page
  return <>{children}</>;
};

// ─── App Content ──────────────────────────────────────────────────────────────

export const AppContent: React.FC = () => {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) return <AuthLoading />;

  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/landing"        element={!user ? <Landing />       : <Navigate to="/" replace />} />
      <Route path="/login"          element={!user ? <Login />         : <Navigate to="/" replace />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* ── New User Flow ── */}
      <Route path="/onboarding" element={<AuthGuard><Onboarding /></AuthGuard>} />
      <Route path="/initialize" element={<AuthGuard><InitializeWorkspace /></AuthGuard>} />
      <Route path="/welcome"    element={<AuthGuard><WelcomeScreen /></AuthGuard>} />
      <Route path="/loading"    element={<AuthGuard><DashboardLoader /></AuthGuard>} />

      {/* ── App Shell — Layout hosts tour overlay so it survives route changes ── */}
      <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
        <Route index                 element={<Dashboard />} />
        <Route path="clients"        element={<ClientProfiles />} />
        <Route path="collections"    element={<Pipeline />} />
        <Route path="timeline"       element={<ReflectionJournal />} />
        <Route path="insights"       element={<Insights />} />
        <Route path="add"            element={<AddInvoice />} />
        <Route path="settings"       element={<Settings />} />

        {/* Legacy URL redirects */}
        <Route path="pipeline"         element={<Navigate to="/collections" replace />} />
        <Route path="invoices"         element={<Navigate to="/clients" replace />} />
        <Route path="reflect"          element={<Navigate to="/timeline" replace />} />
        <Route path="cloud-dashboard"  element={<Navigate to="/" replace />} />
        <Route path="*"                element={<Navigate to="/" replace />} />
      </Route>

      {/* Root catch */}
      <Route path="*" element={<Navigate to="/landing" replace />} />
    </Routes>
  );
};

// ─── Root ─────────────────────────────────────────────────────────────────────

export const App: React.FC = () => (
  <ErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
