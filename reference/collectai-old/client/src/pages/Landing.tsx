import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div 
      style={{
        backgroundColor: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-sans)',
        overflowY: 'auto'
      }}
    >
      {/* Editorial Header */}
      <header 
        style={{
          borderBottom: 'var(--stroke-thick)',
          padding: '16px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--paper-warm)',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            onClick={() => navigate('/')}
          >
            <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>⚡</span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 800 }}>COLLECTAI</span>
          </div>

          <nav style={{ display: 'flex', gap: '24px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
            <a href="#features" style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }}>FEATURES</a>
            <a href="#pricing" style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }}>PRICING</a>
            <a href="#about" style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }}>ABOUT</a>
            <a href="#faq" style={{ color: 'var(--ink)', textDecoration: 'none', fontWeight: 600 }}>FAQ</a>
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {user ? (
            <button 
              className="primary"
              style={{ padding: '10px 20px', fontSize: '0.88rem' }}
              onClick={() => navigate('/')}
            >
              GO TO DASHBOARD →
            </button>
          ) : (
            <>
              <button 
                type="button"
                style={{ 
                  padding: '8px 18px', 
                  fontSize: '0.85rem',
                  background: 'transparent',
                  border: 'var(--stroke)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '3px'
                }}
                onClick={() => navigate('/login')}
              >
                LOGIN
              </button>
              <button 
                className="primary"
                style={{ padding: '8px 18px', fontSize: '0.85rem' }}
                onClick={() => navigate('/login?signup=true')}
              >
                REGISTER
              </button>
            </>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section 
        id="about"
        style={{
          padding: '80px 40px',
          textAlign: 'center',
          borderBottom: 'var(--stroke-thick)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px'
        }}
      >
        <span 
          className="stamp-overlay stamp-nudge"
          style={{ transform: 'rotate(-2deg)', fontSize: '0.75rem', padding: '4px 12px' }}
        >
          AUTONOMOUS PAYMENT RECOVERY
        </span>
        <h1 
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '4.5rem',
            fontWeight: 800,
            lineHeight: '1.05',
            maxWidth: '900px',
            textTransform: 'uppercase',
            letterSpacing: '-0.02em',
            margin: '0 auto'
          }}
        >
          Stop Chasing Clients. Let AI Collect Your Money.
        </h1>
        <p 
          style={{
            fontSize: '1.35rem',
            color: 'var(--muted)',
            maxWidth: '650px',
            margin: '0 auto',
            lineHeight: '1.5'
          }}
        >
          The first autonomous Accounts Receivable AI Employee built specifically for developers, designers, agencies, and small service consultancies.
        </p>

        <div style={{ display: 'flex', gap: '16px', marginTop: '16px', alignItems: 'center' }}>
          {user ? (
            <button 
              className="primary" 
              style={{ padding: '16px 36px', fontSize: '1.1rem' }}
              onClick={() => navigate('/')}
            >
              GO TO DASHBOARD →
            </button>
          ) : (
            <>
              <button 
                type="button"
                style={{ 
                  padding: '16px 28px', 
                  fontSize: '1.05rem',
                  background: 'var(--white)',
                  border: 'var(--stroke)',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '4px',
                  boxShadow: 'var(--shadow-flat-sm)'
                }}
                onClick={() => navigate('/login')}
              >
                LOGIN
              </button>
              <button 
                className="primary" 
                style={{ padding: '16px 36px', fontSize: '1.1rem' }}
                onClick={() => navigate('/login?signup=true')}
              >
                REGISTER NOW →
              </button>
            </>
          )}
        </div>
      </section>

      {/* Problem section */}
      <section 
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: 'var(--stroke-thick)'
        }}
      >
        <div style={{ padding: '60px 40px', borderRight: 'var(--stroke-thick)', backgroundColor: 'var(--paper-warm)' }}>
          <span className="label-text">THE PROBLEM</span>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 800, textTransform: 'uppercase', marginTop: '12px', lineHeight: 1.1 }}>
            Chasing invoices is exhausting & breaks client relationships.
          </h2>
          <p style={{ marginTop: '20px', fontSize: '1.1rem', color: 'var(--muted)', lineHeight: '1.6' }}>
            Freelancers and small service businesses lose up to 15 hours every single month sending awkward payment reminders, tracking balance sheets, and managing late client payables.
          </p>
        </div>
        <div style={{ padding: '60px 40px', display: 'flex', flexDirection: 'column', gap: '24px', justifyContent: 'center' }}>
          {[
            { title: "Awkward follow-ups", desc: "Nobody likes asking clients for cash over email." },
            { title: "Wasted hours tracking", desc: "No more tracking spreadsheets, emails, and WhatsApp timelines." },
            { title: "Late business cashflow", desc: "Service contracts are paid late, damaging studio planning." }
          ].map((item, idx) => (
            <div key={idx} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1.5rem' }}>❌</span>
              <div>
                <h4 style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>{item.title}</h4>
                <p style={{ color: 'var(--muted)', fontSize: '0.95rem' }}>{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section 
        style={{
          padding: '60px 40px',
          borderBottom: 'var(--stroke-thick)'
        }}
      >
        <span className="label-text">THE PROCESS</span>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 800, textTransform: 'uppercase', marginTop: '12px', marginBottom: '40px' }}>
          HOW COLLECTAI RECOVERS YOUR PAYMENTS
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '32px' }}>
          {[
            { step: "01", title: "Monitor Receivables", desc: "Connects directly to your clients. Checks payment due dates, invoices, and response histories." },
            { step: "02", title: "Determine Urgency", desc: "Uses Gemini decision matrixes to gauge overdue intervals and payment probability score." },
            { step: "03", title: "Tune Tone & Channel", desc: "Formulates personalized professional messages through polite email or direct messaging channels." },
            { step: "04", title: "Observe and Adapt", desc: "Tracks payment completion, reflects on the conversation success rate, and updates workspace memory." }
          ].map((item, idx) => (
            <div key={idx} className="os-card" style={{ padding: '24px', backgroundColor: 'var(--white)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 800, color: 'var(--yellow)' }}>{item.step}</span>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800, marginTop: '12px', marginBottom: '8px' }}>{item.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: '0.92rem', lineHeight: '1.5' }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Benefits / Features grid */}
      <section 
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: 'var(--stroke-thick)'
        }}
      >
        <div style={{ padding: '60px 40px', display: 'flex', flexDirection: 'column', gap: '32px', justifySelf: 'center', justifyContent: 'center' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>🤖 GENUINE AI AUTONOMY</h3>
            <p style={{ color: 'var(--muted)', marginTop: '8px', lineHeight: '1.5' }}>
              Unlike simple automated email sequences, CollectAI thinks. It writes customized follow-up strategies tailored to client relationship histories.
            </p>
          </div>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>⚡ MULTI-USER WORKSPACE SECURITY</h3>
            <p style={{ color: 'var(--muted)', marginTop: '8px', lineHeight: '1.5' }}>
              Your workspace is strictly isolated. Every document, invoice action, and client memory logs are scoped to your user ID.
            </p>
          </div>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800 }}>📈 CASHFLOW PROJECTIONS</h3>
            <p style={{ color: 'var(--muted)', marginTop: '8px', lineHeight: '1.5' }}>
              Understand expected payment delays and track overall collections success directly inside your dashboard.
            </p>
          </div>
        </div>
        <div style={{ padding: '60px 40px', borderLeft: 'var(--stroke-thick)', backgroundColor: 'var(--paper-warm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="os-card" style={{ maxWidth: '400px', transform: 'rotate(2deg)' }}>
            <span className="stamp-overlay stamp-paid" style={{ marginBottom: '16px' }}>MEMBER CONFIRMED</span>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '1.1rem', fontWeight: 600, color: 'var(--ink)' }}>
              "CollectAI acts like an agent of our team. It recovered ₹85,000 in overdue design retainer contracts in less than a week without us lifting a finger."
            </p>
            <div style={{ marginTop: '16px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 700 }}>
              — Karthik S., Apex Design Studio
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section 
        style={{
          padding: '80px 40px',
          textAlign: 'center',
          borderBottom: 'var(--stroke-thick)',
          backgroundColor: 'var(--paper-warm)'
        }}
      >
        <span className="label-text">TRANSPARENT PRICING</span>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', fontWeight: 800, textTransform: 'uppercase', marginTop: '12px', marginBottom: '16px' }}>
          ONE FLAT PLAN FOR GROWING STUDIOS
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: '1.1rem', marginBottom: '40px' }}>No hidden setup costs or percentage fees. You keep 100% of recovered cash.</p>

        <div className="os-card" style={{ maxWidth: '440px', margin: '0 auto', backgroundColor: 'var(--white)', padding: '40px' }}>
          <span className="stamp-overlay stamp-nudge" style={{ transform: 'rotate(-4deg)', fontSize: '0.7rem' }}>POPULAR FOR FREELANCERS</span>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 800, marginTop: '20px' }}>AI PARTNER</h3>
          <div style={{ margin: '20px 0' }}>
            <span style={{ fontSize: '3.5rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>₹4,999</span>
            <span style={{ color: 'var(--muted)', fontSize: '1.1rem' }}> / month</span>
          </div>
          <ul style={{ textAlign: 'left', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            <li>✓ Unlimited client invoices</li>
            <li>✓ Full Gemini-1.5 autonomous engine access</li>
            <li>✓ Customized workspace client memory</li>
            <li>✓ Email & messaging notifications dispatch</li>
            <li>✓ Scoped security worksheets</li>
          </ul>
          <button className="primary w-full" onClick={() => navigate('/login')}>
            HIRE COLLECTAI TODAY
          </button>
        </div>
      </section>

      {/* FAQ Section */}
      <section style={{ padding: '60px 40px', borderBottom: 'var(--stroke-thick)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '2.2rem', fontWeight: 800, textTransform: 'uppercase', textAlign: 'center', marginBottom: '40px' }}>
          FREQUENTLY ANSWERED QUESTIONS
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', maxWidth: '1000px', margin: '0 auto' }}>
          {[
            { q: "Is my client database secure?", a: "Yes. Every workspace uses direct document scoping with Firestore multi-tenant checks to ensure zero data cross-leakage." },
            { q: "Does the AI email clients directly?", a: "The AI agent selects tones and channels, drafts the communication, and executes based on your selected schedules and tonal profiles." },
            { q: "Can I run the system locally?", a: "Yes. The system automatically degrades to offline fallback mode using mock data scopes if Google Cloud environments are unconfigured." },
            { q: "How does tone selection work?", a: "Tonal checks adjust based on due dates (polite reminders transition into firm nudges or escalations as the interval advances)." }
          ].map((item, idx) => (
            <div key={idx} className="os-card" style={{ padding: '20px' }}>
              <h4 style={{ fontWeight: 'bold', fontSize: '1.05rem', marginBottom: '8px' }}>Q: {item.q}</h4>
              <p style={{ color: 'var(--muted)', fontSize: '0.92rem', lineHeight: '1.5' }}>{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer 
        style={{
          padding: '40px',
          textAlign: 'center',
          backgroundColor: 'var(--paper-warm)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          color: 'var(--muted)'
        }}
      >
        <div>© {new Date().getFullYear()} COLLECTAI CORPORATION. ALL RIGHTS RESERVED.</div>
        <div style={{ marginTop: '8px' }}>BUILT WITH GEMINI & FIREBASE FOR WORLDWIDE FREELANCE AGENCIES.</div>
      </footer>
    </div>
  );
};
