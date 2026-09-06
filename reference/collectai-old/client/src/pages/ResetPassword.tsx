import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth, verifyPasswordResetCode, confirmPasswordReset } from '../firebase/config';

export const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const actionCode = searchParams.get('oobCode');

  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [verifying, setVerifying] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // 1. Verify the action code on mount
  useEffect(() => {
    if (!actionCode) {
      setError('Invalid password reset link. Missing validation token.');
      setVerifying(false);
      return;
    }

    verifyPasswordResetCode(auth, actionCode)
      .then((verifiedEmail) => {
        setEmail(verifiedEmail);
        setVerifying(false);
      })
      .catch((err) => {
        console.error('[ResetPassword] Verification failed:', err);
        setError('The password reset link is invalid, expired, or has already been used.');
        setVerifying(false);
      });
  }, [actionCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionCode) return;

    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, actionCode, password);
      setSuccess(true);
    } catch (err: any) {
      console.error('[ResetPassword] Reset failed:', err);
      const code = err.code || '';
      if (code === 'auth/expired-action-code') {
        setError('The reset link has expired. Please request a new one.');
      } else if (code === 'auth/invalid-action-code') {
        setError('The reset link is invalid or has already been used.');
      } else if (code === 'auth/weak-password') {
        setError('The password is too weak. Please choose a stronger password.');
      } else {
        setError(err.message || 'Failed to reset password. Please try again.');
      }
    } finally {
      setSubmitting(false);
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

        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '1.25rem',
          fontWeight: 800,
          marginBottom: '20px',
          textAlign: 'center'
        }}>
          RESET PASSWORD
        </h3>

        {/* Loading / Verifying state */}
        {verifying && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
            padding: '20px 0'
          }}>
            <div className="loading-spinner" style={{
              width: '24px',
              height: '24px',
              border: '3px solid var(--border)',
              borderTopColor: 'var(--yellow)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Verifying reset token...</span>
          </div>
        )}

        {/* Error state */}
        {!verifying && error && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
              padding: '12px',
              backgroundColor: 'var(--red)',
              color: 'var(--white)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              border: 'var(--stroke)'
            }}>
              ⚠️ {error}
            </div>
            <button
              onClick={() => navigate('/login')}
              className="primary"
              style={{ width: '100%' }}
            >
              Back to Login
            </button>
          </div>
        )}

        {/* Success state */}
        {!verifying && success && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{
              padding: '16px',
              backgroundColor: 'var(--mint)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              border: 'var(--stroke)',
              fontWeight: 'bold',
              textAlign: 'center'
            }}>
              ✓ Password Reset Successful!
            </div>
            <p style={{
              fontSize: 'var(--text-caption)',
              color: 'var(--muted)',
              textAlign: 'center',
              lineHeight: 1.5
            }}>
              Your password has been successfully updated. You can now return to the login screen and sign in.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="primary"
              style={{ width: '100%' }}
            >
              Go to Login
            </button>
          </div>
        )}

        {/* Form state */}
        {!verifying && !error && !success && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {email && (
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                color: 'var(--muted)',
                backgroundColor: 'var(--paper-warm)',
                padding: '8px 12px',
                border: 'var(--stroke-subtle)',
                borderRadius: '2px',
                marginBottom: '4px'
              }}>
                Account: <strong>{email}</strong>
              </div>
            )}

            <div>
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-label)',
                fontWeight: 'bold',
                marginBottom: '6px'
              }}>
                NEW PASSWORD
              </label>
              <input
                type="password"
                className="input-field"
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoFocus
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-label)',
                fontWeight: 'bold',
                marginBottom: '6px'
              }}>
                CONFIRM NEW PASSWORD
              </label>
              <input
                type="password"
                className="input-field"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              className="primary"
              disabled={submitting}
              style={{ marginTop: '12px', width: '100%' }}
            >
              {submitting ? 'Updating...' : '⚡ Reset Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
