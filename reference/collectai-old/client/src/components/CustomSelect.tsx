import React, { useState, useEffect, useRef } from 'react';

interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  label
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);

  // Filter options based on search query
  const filteredOptions = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    (o.description && o.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {label && <label className="label-text">{label}</label>}
      
      {/* Selected Box Trigger */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '14px 16px',
          background: 'var(--white)',
          border: 'var(--stroke)',
          boxShadow: 'var(--shadow-flat-sm)',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: selectedOption ? 'bold' : 'normal',
          fontFamily: 'var(--font-sans)',
          userSelect: 'none'
        }}
      >
        <span>
          {selectedOption ? (
            <>
              {selectedOption.icon && <span style={{ marginRight: '8px' }}>{selectedOption.icon}</span>}
              {selectedOption.label}
            </>
          ) : (
            <span style={{ color: 'var(--muted)' }}>{placeholder}</span>
          )}
        </span>
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>
          ▼
        </span>
      </div>

      {/* Floating Dropdown Overlay */}
      {isOpen && (
        <div 
          className="os-card"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            zIndex: 9999,
            backgroundColor: 'var(--white)',
            padding: '8px',
            boxShadow: 'var(--shadow-flat-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxHeight: '280px',
            overflowY: 'auto'
          }}
        >
          {/* Internal Search bar */}
          <input 
            type="text"
            className="input-field"
            placeholder="Search option..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '8px 12px',
              fontSize: '0.85rem',
              boxShadow: 'none',
              borderWidth: '1.5px',
              fontFamily: 'var(--font-mono)'
            }}
          />

          {/* List items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredOptions.map((opt) => {
              const isSelected = opt.value === value;

              return (
                <div 
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'var(--yellow)' : 'transparent',
                    border: isSelected ? 'var(--stroke)' : 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    transition: 'background-color 0.15s'
                  }}
                  className="command-item"
                >
                  <div style={{ fontSize: '0.88rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {opt.icon && <span>{opt.icon}</span>}
                    <span>{opt.label}</span>
                  </div>
                  {opt.description && (
                    <div style={{ fontSize: '0.72rem', color: isSelected ? 'var(--ink)' : 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                      {opt.description}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredOptions.length === 0 && (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                No options found.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
export default CustomSelect;
