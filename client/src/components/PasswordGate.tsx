import React, { useState } from 'react';
import { login } from '../api';
import { Lock } from 'lucide-react';

const Mark: React.FC = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" style={{ width: 28, height: 28 }}>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M16 0a16 16 0 1 1 0 32 16 16 0 0 1 0-32Zm0 7.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z"
    />
    <rect x="13.9" y="0" width="4.2" height="11" fill="currentColor" />
  </svg>
);

interface PasswordGateProps {
  onUnlocked: () => void;
}

/**
 * Full-screen lock in front of the whole app when the server has
 * ACCESS_PASSWORD set (server/auth.js) — this is a public demo deployment
 * behind a shared password, not real authentication, so there's no
 * username, no account recovery, just a password and a cookie.
 *
 * App.tsx only mounts this after GET /api/auth/status comes back
 * { required: true, authenticated: false } — everything else (reading the
 * ledger, running the agent, etc.) is already blocked server-side by
 * auth.requireAuth regardless of whether this screen is bypassed somehow,
 * so this is about the experience, not the enforcement.
 */
export const PasswordGate: React.FC<PasswordGateProps> = ({ onUnlocked }) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await login(password);
      if (res.authenticated) {
        onUnlocked();
      } else {
        setError('That password doesn’t match.');
      }
    } catch (err: any) {
      setError(err?.details || err?.error || 'That password doesn’t match.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="field--ink"
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        display: 'grid', placeItems: 'center',
        padding: 20,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 22 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark />
          <span style={{ fontSize: '1.1rem', fontWeight: 800, letterSpacing: '-0.02em' }}>CollectAI</span>
        </div>

        <div>
          <h1 className="title" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Lock size={20} style={{ flex: 'none', opacity: 0.8 }} />
            This demo is locked
          </h1>
          <p className="body body--sm" style={{ opacity: 0.7 }}>
            Enter the shared password to look around.
          </p>
        </div>

        <div>
          <label className="lbl" htmlFor="gate-password">Password</label>
          <input
            id="gate-password"
            className="inp"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error && (
          <p className="body body--sm" style={{ color: 'var(--warn)' }}>{error}</p>
        )}

        <button
          type="submit"
          className="pill pill--lg pill--solid"
          disabled={submitting || !password}
          style={{ justifyContent: 'center' }}
        >
          {submitting ? <><span className="spin" /> Checking…</> : 'Unlock'}
        </button>
      </form>
    </div>
  );
};

export default PasswordGate;
