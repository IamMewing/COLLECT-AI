import React, { useState } from 'react';
import { useStore } from '../store/useStore';

export const BusinessProfile: React.FC = () => {
  const businesses = useStore((state) => state.businesses);
  const selectedBusinessId = useStore((state) => state.selectedBusinessId);
  const setSelectedBusinessId = useStore((state) => state.setSelectedBusinessId);
  const createBusiness = useStore((state) => state.createBusiness);

  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizContact, setBizContact] = useState('');
  const [bizTone, setBizTone] = useState<'polite' | 'neutral' | 'firm'>('polite');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createBusiness({
        name: bizName,
        owner_email: bizEmail,
        owner_contact: bizContact || undefined,
        tone_preference: bizTone
      });
      // Reset form
      setBizName('');
      setBizEmail('');
      setBizContact('');
      setBizTone('polite');
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '2.5rem', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
          🏢 STUDIO & PROFILE PROFILE
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', marginTop: '4px' }}>
          MANAGE YOUR REGISTERED CONSULTING PROFILES AND COLLECTION AGENT TONAL PREFERENCES
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.25fr', gap: '32px', alignItems: 'flex-start' }}>
        
        {/* Register profile form */}
        <div className="os-card" style={{ borderWidth: '3px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800, marginBottom: '20px' }}>
            ➕ REGISTER STUDIO PROFILE
          </h3>
          
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label className="label-text">Freelance / Studio Name *</label>
              <input 
                type="text"
                className="input-field"
                placeholder="e.g. Apex Tech Studio / Rahul Design"
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label-text">Primary Professional Email *</label>
              <input 
                type="email"
                className="input-field"
                placeholder="you@studio.com"
                value={bizEmail}
                onChange={(e) => setBizEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label-text">WhatsApp / Contact Number</label>
              <input 
                type="tel"
                className="input-field"
                placeholder="+91 98765 43210"
                value={bizContact}
                onChange={(e) => setBizContact(e.target.value)}
              />
            </div>

            <div>
              <label className="label-text">AI Nudge Tone Preference</label>
              <select
                className="select-field"
                value={bizTone}
                onChange={(e) => setBizTone(e.target.value as any)}
              >
                <option value="polite">Polite — Warm collaborative follow-up</option>
                <option value="neutral">Neutral — Direct and professional</option>
                <option value="firm">Firm — Formal invoice enforcement</option>
              </select>
            </div>

            <button type="submit" className="primary" style={{ marginTop: '12px' }} disabled={isSubmitting}>
              {isSubmitting ? 'REGISTERING...' : '🏢 REGISTER PROFILE'}
            </button>
          </form>
        </div>

        {/* Profiles list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800 }}>
            📋 REGISTERED ACCOUNTS
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {businesses.map((biz) => {
              const isSelected = selectedBusinessId === biz.business_id;

              return (
                <div 
                  key={biz.business_id}
                  className="os-card"
                  onClick={() => setSelectedBusinessId(biz.business_id)}
                  style={{
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--yellow)' : 'var(--ink)',
                    backgroundColor: isSelected ? 'var(--paper-warm)' : 'var(--white)',
                    borderWidth: isSelected ? '3px' : '2px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 800 }}>
                      {biz.name}
                    </h4>
                    <span className={`stamp-overlay ${isSelected ? 'stamp-nudge' : 'stamp-open'}`} style={{ fontSize: '0.62rem', padding: '2px 6px', transform: 'rotate(-2deg)' }}>
                      {isSelected ? 'ACTIVE' : 'SELECT'}
                    </span>
                  </div>

                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>
                    <div>EMAIL: {biz.owner_email}</div>
                    {biz.owner_contact && <div>PHONE: {biz.owner_contact}</div>}
                    <div style={{ marginTop: '4px', color: 'var(--ink)' }}>
                      TONE SETTING: {biz.tone_preference.toUpperCase()}
                    </div>
                  </div>
                </div>
              );
            })}

            {businesses.length === 0 && (
              <div className="os-card text-center" style={{ padding: '40px' }}>
                <p style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                  No accounts profiles registered yet.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
