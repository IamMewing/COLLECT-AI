import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { db } from '../firebase/config';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { CustomSelect } from '../components/CustomSelect';
import { useNavigate } from 'react-router-dom';

interface AISettings {
  autoRun: boolean;
  checkInterval: '12h' | '24h' | '48h';
  notifyOnResolve: boolean;
}

const DEFAULT_AI_SETTINGS: AISettings = {
  autoRun: true,
  checkInterval: '24h',
  notifyOnResolve: true,
};

export const Settings: React.FC = () => {
  const { user, updateUserProfile, updateUserPassword } = useAuth();
  const navigate = useNavigate();
  const selectedBusinessId = useStore((state) => state.selectedBusinessId);
  const businesses = useStore((state) => state.businesses);
  const fetchBusinesses = useStore((state) => state.fetchBusinesses);
  const addToast = useStore((state) => state.addToast);

  const handleReplayTour = async () => {
    if (!user?.uid) return;
    try {
      await setDoc(doc(db, 'users', user.uid), {
        tourCompleted: false,
      }, { merge: true });
      addToast('Launching interactive product tour...', 'success');
      navigate('/welcome');
    } catch (err: any) {
      addToast(`Failed to reset tour: ${err.message}`, 'error');
    }
  };

  // Profile
  const [profileName, setProfileName] = useState(user?.displayName || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Business
  const activeBusiness = businesses.find(b => b.business_id === selectedBusinessId);
  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizContact, setBizContact] = useState('');
  const [bizTone, setBizTone] = useState<'polite' | 'neutral' | 'firm'>('polite');
  const [timezone, setTimezone] = useState('Asia/Kolkata');

  // AI settings (persisted in Firestore /users/{uid}/settings)
  const [aiSettings, setAiSettings] = useState<AISettings>(DEFAULT_AI_SETTINGS);
  const [aiSettingsSaved, setAiSettingsSaved] = useState(false);

  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingBusiness, setLoadingBusiness] = useState(false);

  // Sync business form with active workspace
  useEffect(() => {
    if (activeBusiness) {
      setBizName(activeBusiness.name);
      setBizEmail(activeBusiness.owner_email);
      setBizContact(activeBusiness.owner_contact || '');
      setBizTone(activeBusiness.tone_preference);
      setTimezone(activeBusiness.timezone || 'Asia/Kolkata');
    }
  }, [activeBusiness, selectedBusinessId]);

  // Load AI settings from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    getDoc(doc(db, 'users', user.uid))
      .then(snap => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.aiSettings) {
            setAiSettings({ ...DEFAULT_AI_SETTINGS, ...data.aiSettings });
          }
        }
      })
      .catch(() => { /* non-fatal */ });
  }, [user?.uid]);

  // Auto-save AI settings to Firestore on change
  const updateAISetting = useCallback(<K extends keyof AISettings>(key: K, value: AISettings[K]) => {
    setAiSettings(prev => {
      const next = { ...prev, [key]: value };

      if (user?.uid) {
        setDoc(doc(db, 'users', user.uid), { aiSettings: next }, { merge: true })
          .then(() => {
            setAiSettingsSaved(true);
            setTimeout(() => setAiSettingsSaved(false), 1500);
          })
          .catch(err => console.warn('Failed to save AI settings:', err));
      }

      return next;
    });
  }, [user?.uid]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingProfile(true);
    try {
      if (profileName.trim() && profileName.trim() !== user?.displayName) {
        await updateUserProfile(profileName.trim());
      }
      if (newPassword.trim()) {
        if (!currentPassword.trim()) {
          addToast('Enter your current password to set a new one', 'error');
          return;
        }
        await updateUserPassword(currentPassword.trim(), newPassword.trim());
        setCurrentPassword('');
        setNewPassword('');
      }
      addToast('Profile updated successfully', 'success');
    } catch (err: any) {
      const msg = err.code === 'auth/wrong-password'
        ? 'Current password is incorrect'
        : err.code === 'auth/requires-recent-login'
        ? 'Session expired — please sign out and sign back in to change your password'
        : err.message || 'Update failed';
      addToast(msg, 'error');
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleUpdateBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBusinessId) {
      addToast('No workspace selected', 'error');
      return;
    }
    setLoadingBusiness(true);
    try {
      await api.updateBusiness(selectedBusinessId, {
        name: bizName,
        owner_email: bizEmail,
        owner_contact: bizContact,
        tone_preference: bizTone,
        timezone,
      });
      addToast('Workspace settings saved', 'success');
      await fetchBusinesses();
    } catch (err: any) {
      addToast(`Save failed: ${err.message}`, 'error');
    } finally {
      setLoadingBusiness(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Settings</h2>
        <p className="page-subtitle">
          Profile · Workspace · AI Behaviour
          {aiSettingsSaved && (
            <span style={{ marginLeft: '12px', color: '#1a7f4b', fontWeight: 600 }}>✓ Saved</span>
          )}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'flex-start' }}>

        {/* Left: Profile + AI Behaviour */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Profile */}
          <div className="os-card">
            <h3 className="section-title">Profile</h3>
            <form onSubmit={handleUpdateProfile} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="label-text">Display Name</label>
                <input
                  type="text"
                  className="input-field"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </div>
              <div>
                <label className="label-text">Email (read-only)</label>
                <input type="email" className="input-field" value={user?.email || ''} disabled />
              </div>

              <div style={{ borderTop: 'var(--stroke-subtle)', paddingTop: '14px', marginTop: '4px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)', color: 'var(--muted)', marginBottom: '10px' }}>
                  CHANGE PASSWORD (optional)
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label className="label-text">Current Password</label>
                    <input
                      type="password"
                      className="input-field"
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </div>
                  <div>
                    <label className="label-text">New Password</label>
                    <input
                      type="password"
                      className="input-field"
                      placeholder="Minimum 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      minLength={6}
                    />
                  </div>
                </div>
              </div>

              <button type="submit" className="primary" disabled={loadingProfile}>
                {loadingProfile ? 'Saving...' : 'Update Profile'}
              </button>
            </form>
          </div>

          {/* AI Behaviour */}
          <div className="os-card">
            <h3 className="section-title">AI Behaviour</h3>
            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted)', marginBottom: '16px', marginTop: '-8px' }}>
              Settings are synced to your account automatically.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <label className="checkbox-container">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={aiSettings.autoRun}
                  onChange={(e) => updateAISetting('autoRun', e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Enable autonomous evaluation cycles</span>
              </label>

              <CustomSelect
                label="Check Frequency"
                value={aiSettings.checkInterval}
                onChange={(val) => updateAISetting('checkInterval', val as AISettings['checkInterval'])}
                options={[
                  { value: '12h', label: 'Every 12 hours', description: 'Semi-daily evaluations' },
                  { value: '24h', label: 'Every 24 hours', description: 'Standard daily cycle' },
                  { value: '48h', label: 'Every 48 hours', description: 'Bi-daily audits' },
                ]}
              />

              <label className="checkbox-container">
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={aiSettings.notifyOnResolve}
                  onChange={(e) => updateAISetting('notifyOnResolve', e.target.checked)}
                />
                <span>Notify when invoices are auto-resolved</span>
              </label>
            </div>
          </div>

          {/* Guided Tour Reset */}
          <div className="os-card" style={{ marginTop: '24px' }}>
            <h3 className="section-title">Product Guide</h3>
            <p style={{ fontSize: 'var(--text-caption)', color: 'var(--muted)', marginBottom: '16px', marginTop: '-8px' }}>
              Want a refresher on the interface? Reset and replay the interactive product tour.
            </p>
            <button
              type="button"
              onClick={handleReplayTour}
              className="secondary"
              style={{ width: '100%' }}
            >
              Replay Product Tour 🧭
            </button>
          </div>
        </div>

        {/* Right: Workspace */}
        <div className="os-card">
          <h3 className="section-title">Workspace</h3>

          {!selectedBusinessId ? (
            <p style={{ color: 'var(--muted)', fontSize: 'var(--text-caption)' }}>
              No workspace selected. Create one from Onboarding.
            </p>
          ) : (
            <form onSubmit={handleUpdateBusiness} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="label-text">Studio Name</label>
                <input type="text" className="input-field" value={bizName} onChange={(e) => setBizName(e.target.value)} required />
              </div>
              <div>
                <label className="label-text">Contact Email</label>
                <input type="email" className="input-field" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} required />
              </div>
              <div>
                <label className="label-text">Phone</label>
                <input type="tel" className="input-field" value={bizContact} onChange={(e) => setBizContact(e.target.value)} />
              </div>
              <div>
                <label className="label-text">Timezone</label>
                <input type="text" className="input-field" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              </div>
              <CustomSelect
                label="Reminder Tone"
                value={bizTone}
                onChange={(val) => setBizTone(val as any)}
                options={[
                  { value: 'polite', label: 'Polite', description: 'Warm, understanding reminders' },
                  { value: 'neutral', label: 'Neutral', description: 'Professional and factual' },
                  { value: 'firm', label: 'Firm', description: 'Direct and assertive' },
                ]}
              />
              <button type="submit" className="primary" style={{ marginTop: '8px' }} disabled={loadingBusiness}>
                {loadingBusiness ? 'Saving...' : 'Save Workspace'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
