import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { createWorkspace } from '../lib/workspace';
import { api } from '../lib/api';
import { auth } from '../firebase/config';
import { updateProfile } from 'firebase/auth';
import gsap from 'gsap';

// ─── Step types ───────────────────────────────────────────────────────────────

interface WizardData {
  displayName: string;
  studioName: string;
  profession: string;
  businessSize: string;
  country: string;
  timezone: string;
  currency: string;
  language: string;
  phone: string;
  reminderTone: 'polite' | 'neutral' | 'firm';
  invoicePrefix: string;
  ownerEmail: string;
  recoveryGoal: string;
  preferredContactMethod: string;
}

const PROFESSIONS = [
  { value: 'Freelancer', icon: '💻', label: 'Freelancer' },
  { value: 'Agency', icon: '🏢', label: 'Agency' },
  { value: 'Studio', icon: '🎨', label: 'Studio' },
  { value: 'Consultancy', icon: '💼', label: 'Consultancy' },
  { value: 'Startup', icon: '🚀', label: 'Startup' },
  { value: 'Other', icon: '✦', label: 'Other' },
];

const BUSINESS_SIZES = [
  { value: 'Only Me', label: 'Only Me', sub: 'Solo operator' },
  { value: '2-5', label: '2 – 5', sub: 'Small team' },
  { value: '5-20', label: '5 – 20', sub: 'Growing studio' },
  { value: '20+', label: '20+', sub: 'Established' },
];

const CURRENCIES = [
  { value: 'INR', label: '₹ INR — Indian Rupee' },
  { value: 'USD', label: '$ USD — US Dollar' },
  { value: 'EUR', label: '€ EUR — Euro' },
  { value: 'GBP', label: '£ GBP — British Pound' },
  { value: 'AED', label: 'د.إ AED — UAE Dirham' },
  { value: 'SGD', label: 'S$ SGD — Singapore Dollar' },
];



const TOTAL_STEPS = 10;

// ─── Step indicator ───────────────────────────────────────────────────────────

const StepDots: React.FC<{ current: number; total: number }> = ({ current, total }) => (
  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
    {Array.from({ length: total }).map((_, i) => (
      <div key={i} style={{
        width: i === current ? '24px' : '6px',
        height: '6px',
        borderRadius: '3px',
        background: i < current ? 'var(--ink)' : i === current ? 'var(--yellow)' : 'var(--border)',
        transition: 'all 0.35s var(--ease-out)',
      }} />
    ))}
  </div>
);

// ─── Field wrapper ────────────────────────────────────────────────────────────

const Field: React.FC<{ label: string; children: React.ReactNode; note?: string }> = ({ label, children, note }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <label style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-label)',
      fontWeight: 600,
      letterSpacing: '0.06em',
      color: 'var(--muted)',
      textTransform: 'uppercase',
    }}>{label}</label>
    {children}
    {note && (
      <span style={{ fontSize: 'var(--text-label)', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{note}</span>
    )}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [data, setData] = useState<WizardData>({
    displayName: user?.displayName || '',
    studioName: '',
    profession: '',
    businessSize: '',
    country: 'India',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    currency: 'INR',
    language: 'English',
    phone: '',
    reminderTone: 'polite',
    invoicePrefix: 'INV',
    ownerEmail: user?.email || '',
    recoveryGoal: '100000',
    preferredContactMethod: 'email',
  });

  const update = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData(prev => ({ ...prev, [key]: value }));

  // Animate step transition
  const animateStep = useCallback((direction: 1 | -1) => {
    if (!stepRef.current) return;
    gsap.fromTo(stepRef.current,
      { opacity: 0, x: direction * 40 },
      { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' }
    );
  }, []);

  const next = useCallback(() => {
    setError('');
    // Validate current step
    if (step === 1 && !data.displayName.trim()) { setError('Please enter your full name.'); return; }
    if (step === 2 && !data.studioName.trim()) { setError('Please enter your business or studio name.'); return; }
    if (step === 3 && !data.profession) { setError('Please select your business type.'); return; }
    if (step === 4 && !data.phone.trim()) { setError('Please enter your phone number for WhatsApp reminders.'); return; }
    if (step === 5 && !data.country.trim()) { setError('Please enter your country.'); return; }
    if (step === 6 && !data.currency.trim()) { setError('Please select your currency.'); return; }
    if (step === 7 && !data.timezone.trim()) { setError('Please select your timezone.'); return; }
    if (step === 8 && !data.businessSize) { setError('Please select your team size.'); return; }
    if (step === 9 && !data.recoveryGoal.trim()) { setError('Please set a recovery goal.'); return; }
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
      setTimeout(() => animateStep(1), 10);
    }
  }, [step, data, animateStep]);

  const back = useCallback(() => {
    setError('');
    if (step > 0) {
      setStep(s => s - 1);
      setTimeout(() => animateStep(-1), 10);
    }
  }, [step, animateStep]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && step !== TOTAL_STEPS - 1) {
        const active = document.activeElement as HTMLElement;
        if (active?.tagName === 'TEXTAREA') return;
        if (active?.tagName === 'INPUT' && active.getAttribute('type') === 'tel') { next(); return; }
        if (active?.tagName === 'SELECT') return;
        // Don't auto-advance on button clicks
        if (active?.tagName === 'BUTTON') return;
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, step]);

  // Initial entrance animation
  useEffect(() => {
    if (containerRef.current) {
      gsap.fromTo(containerRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' }
      );
    }
  }, []);

  const handleCreate = async () => {
    setSubmitting(true);
    setError('');
    try {
      if (!user?.uid) throw new Error('No authenticated user.');

      // 1. Create workspace in Firestore
      await createWorkspace(user.uid, {
        displayName: data.displayName,
        studioName: data.studioName,
        profession: data.profession,
        businessSize: data.businessSize,
        country: data.country,
        timezone: data.timezone,
        currency: data.currency,
        language: data.language,
        phone: data.phone,
        reminderTone: data.reminderTone,
        invoicePrefix: data.invoicePrefix,
        ownerEmail: data.ownerEmail,
        recoveryGoal: data.recoveryGoal,
        preferredContactMethod: data.preferredContactMethod,
      });

      // Synchronously mark sessionStorage so AuthGuard won't bounce back due to Firestore propagation latency
      sessionStorage.setItem('onboardingCompleted', user.uid);
      sessionStorage.setItem('workspaceInitialized', user.uid);

      // 2. Sync the human-readable name to Firebase Auth so WelcomeScreen shows the correct name
      if (auth.currentUser && data.displayName.trim()) {
        try {
          await updateProfile(auth.currentUser, { displayName: data.displayName.trim() });
        } catch (profileErr) {
          console.warn('[Onboarding] updateProfile non-fatal:', profileErr);
        }
      }

      // 3. Provision backend business record (non-blocking)
      try {
        await api.createBusiness({
          name: data.studioName,
          owner_email: data.ownerEmail,
          owner_contact: data.phone || undefined,
          preferred_channel: data.preferredContactMethod as any,
          tone_preference: data.reminderTone,
          timezone: data.timezone,
        });
      } catch (backendErr) {
        console.warn('[Onboarding] Backend API provision notice:', backendErr);
      }

      // Navigate to cinematic init screen
      navigate('/initialize', { replace: true });
    } catch (err: any) {
      const msg = err.code === 'permission-denied'
        ? 'Permission denied. Please check your Firestore security rules.'
        : err.message || 'Failed to create workspace. Please check your connection and try again.';
      setError(msg);
      setSubmitting(false);
    }
  };

  // ─── Step renderers ─────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // Step 0: Welcome
      case 0:
        return (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
            <div style={{
              width: '72px', height: '72px',
              background: 'var(--yellow)',
              border: '3px solid var(--ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '2rem',
              boxShadow: 'var(--shadow-flat-md)',
            }}>⚡</div>
            <div>
              <h1 style={{
                fontFamily: 'var(--font-display)',
                fontSize: '2.2rem',
                fontWeight: 800,
                letterSpacing: '-0.02em',
              }}>
                Meet your AI employee.
              </h1>
              <p style={{
                marginTop: '12px',
                fontSize: '1.05rem',
                color: 'var(--muted)',
                maxWidth: '400px',
                lineHeight: 1.65,
              }}>
                CollectAI autonomously chases your overdue invoices using
                Gemini AI — so you never have to send awkward payment reminders again.
              </p>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              width: '100%',
              maxWidth: '420px',
            }}>
              {[
                { icon: '📋', label: 'Tracks invoices' },
                { icon: '🧠', label: 'Reasons with AI' },
                { icon: '✉️', label: 'Sends reminders' },
              ].map(f => (
                <div key={f.label} style={{
                  padding: '16px 12px',
                  border: 'var(--stroke-subtle)',
                  borderRadius: '4px',
                  textAlign: 'center',
                  background: 'var(--paper-warm)',
                }}>
                  <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>{f.icon}</div>
                  <div style={{ fontSize: 'var(--text-label)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{f.label}</div>
                </div>
              ))}
            </div>
          </div>
        );

      // Step 1: Name
      case 1:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>What's your name?</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                This is how your AI employee will address you.
              </p>
            </div>
            <Field label="Full Name">
              <input
                className="input-field"
                type="text"
                placeholder="e.g. Dharmatheja Bairy"
                value={data.displayName}
                onChange={e => update('displayName', e.target.value)}
                autoFocus
                style={{ fontSize: '1.1rem', padding: '14px 16px' }}
              />
            </Field>
          </div>
        );

      // Step 2: Studio name
      case 2:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>Name your workspace.</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                This is your studio or company name.
              </p>
            </div>
            <Field label="Studio / Company Name">
              <input
                className="input-field"
                type="text"
                placeholder="e.g. Monarch Studios"
                value={data.studioName}
                onChange={e => update('studioName', e.target.value)}
                autoFocus
                style={{ fontSize: '1.1rem', padding: '14px 16px' }}
              />
            </Field>
            <Field label="Billing Email">
              <input
                className="input-field"
                type="email"
                placeholder="billing@yourstudio.com"
                value={data.ownerEmail}
                onChange={e => update('ownerEmail', e.target.value)}
              />
            </Field>
          </div>
        );

      // Step 3: Profession
      case 3:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>What do you do?</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                This helps the AI write reminders that sound like you.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {PROFESSIONS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('profession', p.value)}
                  style={{
                    padding: '16px 12px',
                    border: data.profession === p.value ? '2.5px solid var(--ink)' : 'var(--stroke-subtle)',
                    borderRadius: '4px',
                    background: data.profession === p.value ? 'var(--yellow)' : 'var(--white)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: data.profession === p.value ? 'var(--shadow-flat-sm)' : 'none',
                    transition: 'all 0.18s ease',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <span style={{ fontSize: '1.5rem' }}>{p.icon}</span>
                  <span style={{ fontSize: 'var(--text-caption)', fontWeight: 600 }}>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        );

      // Step 4: Phone Number (Required for WhatsApp reminders)
      case 4:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>Phone Number *</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                Required — future AI payment reminders dispatch updates to your WhatsApp number.
              </p>
            </div>
            <Field label="Phone Number" note="Format: +91 98765 43210">
              <input
                className="input-field"
                type="tel"
                placeholder="+91 98765 43210"
                value={data.phone}
                onChange={e => update('phone', e.target.value)}
                autoFocus
                required
                style={{ fontSize: '1.1rem', padding: '14px 16px' }}
              />
            </Field>

            <div style={{ padding: '16px', background: 'var(--paper-warm)', border: 'var(--stroke-subtle)', borderRadius: '4px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)', color: 'var(--muted)', marginBottom: '8px' }}>
                DEFAULT REMINDER TONE
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['polite', 'neutral', 'firm'] as const).map(t => (
                  <button key={t} type="button"
                    onClick={() => update('reminderTone', t)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      border: data.reminderTone === t ? '2px solid var(--ink)' : 'var(--stroke-subtle)',
                      borderRadius: '3px',
                      background: data.reminderTone === t ? 'var(--yellow)' : 'var(--white)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      transition: 'all 0.18s ease',
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      // Step 5: Country
      case 5:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>Country *</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                Where is your studio or consultancy registered?
              </p>
            </div>
            <Field label="Country">
              <input 
                className="input-field" 
                type="text" 
                placeholder="e.g. India"
                value={data.country} 
                onChange={e => update('country', e.target.value)} 
                autoFocus
              />
            </Field>
          </div>
        );

      // Step 6: Currency
      case 6:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>Currency *</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                Default billing currency for invoices and balance tracking.
              </p>
            </div>
            <Field label="Currency">
              <select 
                className="input-field" 
                value={data.currency} 
                onChange={e => update('currency', e.target.value)}
                style={{ fontFamily: 'var(--font-sans)', cursor: 'pointer', fontSize: '1rem', padding: '12px 16px' }}
              >
                {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
        );

      // Step 7: Timezone
      case 7:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>Timezone *</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                Used for scheduling collection reminders during business hours.
              </p>
            </div>
            <Field label="Timezone">
              <input 
                className="input-field" 
                type="text" 
                value={data.timezone} 
                onChange={e => update('timezone', e.target.value)} 
                autoFocus
              />
            </Field>
          </div>
        );

      // Step 8: Team Size & Preferred Contact Method
      case 8:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>Workspace Setup *</h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                We'll calibrate your AI workspace strategy and channels.
              </p>
            </div>
            
            <Field label="Team Size">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                {BUSINESS_SIZES.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => update('businessSize', s.value)}
                    style={{
                      padding: '16px 12px',
                      border: data.businessSize === s.value ? '2.5px solid var(--ink)' : 'var(--stroke-subtle)',
                      borderRadius: '4px',
                      background: data.businessSize === s.value ? 'var(--yellow)' : 'var(--white)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      boxShadow: data.businessSize === s.value ? 'var(--shadow-flat-sm)' : 'none',
                      transition: 'all 0.18s ease',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{s.label}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px' }}>{s.sub}</div>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Preferred Contact Method">
              <select
                className="input-field"
                value={data.preferredContactMethod}
                onChange={e => update('preferredContactMethod', e.target.value)}
                style={{ fontFamily: 'var(--font-sans)', cursor: 'pointer', fontSize: '1rem', padding: '12px 16px' }}
              >
                <option value="email">Email reminders</option>
                <option value="whatsapp">WhatsApp reminders</option>
                <option value="sms">SMS text reminders</option>
              </select>
            </Field>
          </div>
        );

      // Step 9: Recovery Goal & Review
      case 9:
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>
                Set Goal & Deploy
              </h2>
              <p style={{ color: 'var(--muted)', marginTop: '6px', fontSize: 'var(--text-caption)' }}>
                Establish a recovery target and review your credentials.
              </p>
            </div>

            <Field label="Recovery Goal Amount (₹)" note="What is your target recovery amount for overdue invoices?">
              <input
                className="input-field"
                type="number"
                placeholder="e.g. 100000"
                value={data.recoveryGoal}
                onChange={e => update('recoveryGoal', e.target.value)}
                required
              />
            </Field>

            <div style={{
              background: 'var(--paper-warm)',
              border: 'var(--stroke-subtle)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              {[
                { label: 'Name', value: data.displayName },
                { label: 'Studio', value: data.studioName },
                { label: 'Type', value: data.profession },
                { label: 'Phone', value: data.phone },
                { label: 'Country', value: data.country },
                { label: 'Currency', value: data.currency },
                { label: 'Timezone', value: data.timezone },
                { label: 'Team Size', value: data.businessSize },
                { label: 'Contact', value: data.preferredContactMethod.toUpperCase() },
                { label: 'Goal Target', value: `₹${parseFloat(data.recoveryGoal || '0').toLocaleString('en-IN')}` },
              ].map((row, i) => (
                <div key={row.label} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 16px',
                  borderBottom: i < 9 ? 'var(--stroke-subtle)' : 'none',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {row.label}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{row.value || '—'}</span>
                </div>
              ))}
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                background: '#FEE',
                border: '1.5px solid var(--red)',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-caption)',
                color: 'var(--red)',
              }}>
                ⚠️ {error}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const isLastStep = step === TOTAL_STEPS - 1;
  const isFirstStep = step === 0;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: 'var(--paper)',
      overflow: 'hidden',
    }}>
      {/* Left: Brand panel */}
      <div style={{
        width: '280px',
        flexShrink: 0,
        background: 'var(--ink)',
        color: 'var(--paper)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '40px 32px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '40px' }}>
            <span style={{
              background: 'var(--yellow)', color: 'var(--ink)',
              width: '32px', height: '32px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: '1.1rem',
            }}>⚡</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.01em' }}>
              CollectAI
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              { n: 1, label: 'Welcome' },
              { n: 2, label: 'Full Name' },
              { n: 3, label: 'Studio Name' },
              { n: 4, label: 'Business Type' },
              { n: 5, label: 'Phone Number' },
              { n: 6, label: 'Country' },
              { n: 7, label: 'Currency' },
              { n: 8, label: 'Timezone' },
              { n: 9, label: 'Team Size' },
              { n: 10, label: 'Create Workspace' },
            ].map(({ n, label }) => {
              const idx = n - 1;
              const done = step > idx;
              const active = step === idx;
              return (
                <div key={n} style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  opacity: done ? 0.5 : active ? 1 : 0.3,
                  transition: 'opacity 0.3s',
                }}>
                  <div style={{
                    width: '22px', height: '22px',
                    borderRadius: '50%',
                    background: done ? 'var(--yellow)' : active ? 'var(--yellow)' : 'rgba(255,255,255,0.1)',
                    border: active ? '2px solid var(--yellow)' : done ? 'none' : '1.5px solid rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.65rem', fontWeight: 700, color: 'var(--ink)',
                    flexShrink: 0,
                    transition: 'all 0.3s',
                  }}>
                    {done ? '✓' : n}
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)',
                    color: active ? 'var(--yellow)' : 'var(--paper)',
                    fontWeight: active ? 700 : 400,
                  }}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-label)', color: 'rgba(255,255,255,0.3)' }}>
          Workspace setup takes less than 2 minutes.
        </div>
      </div>

      {/* Right: Step content */}
      <div ref={containerRef} style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        position: 'relative',
      }}>
        {/* Progress bar */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '3px',
          background: 'var(--border)',
          zIndex: 10,
        }}>
          <div style={{
            height: '100%',
            background: 'var(--yellow)',
            width: `${((step + 1) / TOTAL_STEPS) * 100}%`,
            transition: 'width 0.4s var(--ease-out)',
          }} />
        </div>

        {/* Scrollable content area — minHeight:0 is required for flex children to scroll correctly */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '40px 80px 24px 80px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
        }}>
          <div ref={stepRef} style={{ width: '100%', maxWidth: '520px', paddingBottom: '8px' }}>
            {renderStep()}
          </div>
        </div>

        {/* Footer Area with Navigation */}
        <div style={{
          padding: '24px 80px 32px 80px',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          borderTop: 'var(--stroke-subtle)',
          background: 'var(--paper)',
          width: '100%',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            maxWidth: '520px',
          }}>
            <StepDots current={step} total={TOTAL_STEPS} />

            <div style={{ display: 'flex', gap: '10px' }}>
              {!isFirstStep && (
                <button
                  type="button"
                  onClick={back}
                  disabled={submitting}
                  style={{
                    padding: '12px 24px',
                    background: 'transparent',
                    border: 'var(--stroke)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-caption)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    borderRadius: '3px',
                    transition: 'all 0.18s',
                  }}
                >
                  ← Back
                </button>
              )}

              {isLastStep ? (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={submitting}
                  className="primary"
                  style={{ padding: '12px 32px', fontSize: 'var(--text-caption)' }}
                >
                  {submitting ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        width: '14px', height: '14px',
                        border: '2px solid rgba(0,0,0,0.3)',
                        borderTopColor: 'var(--ink)',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                      }} />
                      Creating...
                    </span>
                  ) : '⚡ Create Workspace →'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={next}
                  className="primary"
                  style={{ padding: '12px 32px', fontSize: 'var(--text-caption)' }}
                >
                  {step === 0 ? "Let's go →" : 'Continue →'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default Onboarding;
