import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useNavigate } from 'react-router-dom';

export const CommandBar: React.FC = () => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const invoices = useStore((state) => state.invoices);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const commands = [
    { title: 'Show overdue invoices', action: () => { navigate('/'); setIsOpen(false); } },
    { title: 'Who is highest risk client', action: () => { navigate('/invoices'); setIsOpen(false); } },
    { title: 'Assign new collection task', action: () => { navigate('/add'); setIsOpen(false); } },
    { title: 'Explain today\'s decisions', action: () => { navigate('/reflect'); setIsOpen(false); } },
    { title: 'Manage workspace settings', action: () => { navigate('/settings'); setIsOpen(false); } }
  ];

  // Filter items
  const filteredCommands = commands.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));
  const filteredInvoices = invoices.filter(i => i.client_name.toLowerCase().includes(search.toLowerCase()) || i.invoice_id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 10, 10, 0.75)',
        zIndex: 999999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '100px',
        paddingLeft: '24px',
        paddingRight: '24px',
        backdropFilter: 'blur(3px)'
      }}
    >
      <div 
        className="os-card"
        style={{
          width: '100%',
          maxWidth: '600px',
          backgroundColor: 'var(--white)',
          borderWidth: '3px',
          boxShadow: 'var(--shadow-flat-lg)',
          padding: 0
        }}
      >
        <div style={{ display: 'flex', borderBottom: 'var(--stroke)' }}>
          <input 
            ref={inputRef}
            type="text"
            className="input-field"
            placeholder="Type a command or search workspace..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: 'none',
              boxShadow: 'none',
              fontSize: '1.1rem',
              padding: '16px 20px',
              fontFamily: 'var(--font-mono)'
            }}
          />
        </div>

        <div style={{ maxHeight: '340px', overflowY: 'auto', padding: '12px' }}>
          {/* Quick Actions */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', paddingLeft: '8px', marginBottom: '8px', textTransform: 'uppercase' }}>
              Suggested Actions
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {filteredCommands.map((c, idx) => (
                <div 
                  key={idx}
                  onClick={c.action}
                  style={{
                    padding: '10px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  className="command-item"
                >
                  <span>⚡ {c.title}</span>
                  <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Command</span>
                </div>
              ))}
            </div>
          </div>

          {/* Search Results */}
          {filteredInvoices.length > 0 && (
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', paddingLeft: '8px', marginBottom: '8px', textTransform: 'uppercase' }}>
                Client Invoices & Files
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {filteredInvoices.slice(0, 5).map((inv) => (
                  <div 
                    key={inv.id}
                    onClick={() => { navigate('/invoices'); setIsOpen(false); }}
                    style={{
                      padding: '10px 12px',
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between'
                    }}
                    className="command-item"
                  >
                    <span style={{ fontWeight: 'bold' }}>{inv.client_name} ({inv.invoice_id})</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: '0.8rem' }}>
                      ₹{inv.amount.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredCommands.length === 0 && filteredInvoices.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
              No matches found.
            </div>
          )}
        </div>

        <div 
          style={{
            padding: '10px 16px',
            backgroundColor: 'var(--paper-warm)',
            borderTop: 'var(--stroke)',
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--muted)'
          }}
        >
          <span>Use ↑↓ to navigate, Enter to select</span>
          <span>ESC to close</span>
        </div>
      </div>
    </div>
  );
};
