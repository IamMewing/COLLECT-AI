import React, { useEffect, useState } from 'react';
import { Activity, Cpu, RefreshCw, ShieldCheck } from 'lucide-react';

interface HeaderProps {
  onRefresh?: () => void;
  isLoading?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onRefresh, isLoading }) => {
  const [clock, setClock] = useState<string>('');

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        height: 'var(--header-height)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 28px',
        background: 'rgba(9,12,20,0.72)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        borderBottom: '1px solid var(--border-glow)',
      }}
    >
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: 42, height: 42, borderRadius: 11,
            display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg, rgba(255,210,63,0.16), rgba(0,229,199,0.10))',
            border: '1px solid rgba(255,210,63,0.35)',
            boxShadow: '0 0 22px rgba(255,210,63,0.18)',
          }}
        >
          <span
            className="display-title glow-gold"
            style={{ fontSize: '1.05rem', color: 'var(--gold)', fontWeight: 800 }}
          >
            C
          </span>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="display-title" style={{ fontSize: '1.2rem', letterSpacing: '-0.02em' }}>
              CollectAI
            </span>
            <span className="badge badge-healthy" style={{ padding: '2px 8px' }}>
              <span className="pulse-dot" style={{ width: 6, height: 6 }} /> Strands Ledger
            </span>
          </div>
          <div className="mono-label" style={{ marginTop: 2, fontSize: '0.6rem' }}>
            Midnight Ledger · Autonomous Receivables · Human-in-the-Loop
          </div>
        </div>
      </div>

      {/* Status cluster */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          className="badge badge-neutral"
          style={{ display: 'none' }}
          data-hide-mobile
        />
        <div className="badge badge-gold" title="Model provider">
          <Cpu size={12} /> Gemini 3.1 Flash-Lite
        </div>
        <div className="badge badge-healthy" title="Execution engine">
          <ShieldCheck size={12} /> Real Strands
        </div>
        <div
          className="mono-value"
          style={{
            fontSize: '0.82rem', color: 'var(--text-secondary)',
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid var(--border-subtle)', background: 'rgba(11,15,25,0.6)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <Activity size={13} color="var(--healthy)" /> {clock}
        </div>
        {onRefresh && (
          <button
            className="btn btn-neutral"
            onClick={onRefresh}
            disabled={isLoading}
            style={{ padding: '9px 16px', fontSize: '0.82rem' }}
          >
            <RefreshCw size={13} className={isLoading ? 'spinner' : ''} style={isLoading ? { border: 'none' } : undefined} />
            Sync
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
