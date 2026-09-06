import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const Login: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { loginWithGoogle, loginWithEmail, signupWithEmail, resetPassword } = useAuth();

  const [isSignUp, setIsSignUp] = useState(searchParams.get('signup') === 'true');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (searchParams.get('signup') === 'true') {
      setIsSignUp(true);
    }
  }, [searchParams]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signupWithEmail(email, password);
      } else {
        await loginWithEmail(email, password);
      }
      // Central AuthGuard will evaluate workspace and navigate cleanly
    } catch (err: any) {
      // Surface Firebase auth error codes in a human-readable way
      const code = err.code || '';
      if (code === 'auth/user-not-found') {
        setError('No account found.');
      } else if (code === 'auth/wrong-password') {
        setError('Incorrect password.');
      } else if (code === 'auth/invalid-credential') {
        setError('Incorrect email or password.');
      } else if (code === 'auth/user-disabled') {
        setError('This account has been disabled. Please contact support.');
      } else if (code === 'auth/network-request-failed') {
        setError('Network error. Please check your internet connection and try again.');
      } else if (code === 'auth/popup-blocked') {
        setError('Popup blocked by browser. Please allow popups for Google sign-in.');
      } else if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Try logging in.');
      } else if (code === 'auth/weak-password') {
        setError('Password must be at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many failed attempts. Please wait a moment and try again.');
      } else {
        setError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);
    try {
      await loginWithGoogle();
      // Central AuthGuard will evaluate workspace state and navigate
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Sign-in popup was blocked by your browser. Please allow popups.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Network error during Google sign-in. Please check your connection.');
      } else {
        setError(err.message || 'Google sign-in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: 'var(--paper)',
      padding: '24px'
    }}>
      <div className="os-card" style={{
        width: '100%',
        maxWidth: '440px',
        backgroundColor: 'var(--white)',
        padding: '40px',
        borderWidth: '3px'
      }}>
        {/* Logo */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '32px',
          justifyContent: 'center'
        }}>
          <span style={{ fontSize: '1.8rem', fontWeight: 800 }}>⚡</span>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>COLLECTAI</span>
        </div>

        {/* Error message */}
        {error && (
          <div style={{
            padding: '12px',
            backgroundColor: 'var(--red)',
            color: 'var(--white)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            marginBottom: '20px',
            border: 'var(--stroke)'
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Forgot password flow */}
        {forgotPasswordMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800 }}>
              RESET PASSWORD
            </h3>

            {resetSent ? (
              <div style={{
                padding: '16px',
                background: 'var(--mint)',
                border: 'var(--stroke)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                lineHeight: 1.5
              }}>
                ✓ Reset link sent to <strong>{email}</strong>.<br />
                Check your inbox and follow the link to set a new password.
              </div>
            ) : (
              <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label className="label-text">YOUR EMAIL</label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="you@studio.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="primary w-full" disabled={loading}>
                  {loading ? 'SENDING...' : '✉️ SEND RESET LINK'}
                </button>
              </form>
            )}

            <button
              type="button"
              onClick={() => { setForgotPasswordMode(false); setResetSent(false); }}
              style={{ background: 'none', border: 'none', textDecoration: 'underline', boxShadow: 'none', padding: 0 }}
            >
              ← Back to Login
            </button>
          </div>

        ) : (
          /* Main login/signup form */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <form onSubmit={handleEmailAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800 }}>
                {isSignUp ? 'CREATE YOUR WORKSPACE' : 'SIGN IN TO YOUR WORKSPACE'}
              </h3>

              <div>
                <label className="label-text">EMAIL</label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="you@studio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete={isSignUp ? 'email' : 'username'}
                />
              </div>

              <div>
                <label className="label-text">PASSWORD</label>
                <input
                  type="password"
                  className="input-field"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  minLength={6}
                />
              </div>

              {!isSignUp && (
                <div style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => setForgotPasswordMode(true)}
                    style={{ background: 'none', border: 'none', boxShadow: 'none', padding: 0, textDecoration: 'underline', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              <button type="submit" className="primary w-full" disabled={loading}>
                {loading
                  ? 'AUTHENTICATING...'
                  : isSignUp
                  ? 'CREATE ACCOUNT'
                  : 'SIGN IN'}
              </button>
            </form>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <hr style={{ flex: 1, borderColor: 'var(--border)' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>OR</span>
              <hr style={{ flex: 1, borderColor: 'var(--border)' }} />
            </div>

            {/* Google Sign-In */}
            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              style={{
                width: '100%',
                justifyContent: 'center',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            {/* Toggle sign-up / sign-in */}
            <div style={{ textAlign: 'center', fontSize: '0.85rem' }}>
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              <button
                type="button"
                onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
                style={{ background: 'none', border: 'none', boxShadow: 'none', padding: 0, textDecoration: 'underline', fontWeight: 'bold', textTransform: 'none' }}
              >
                {isSignUp ? 'Sign in' : 'Sign up free'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
