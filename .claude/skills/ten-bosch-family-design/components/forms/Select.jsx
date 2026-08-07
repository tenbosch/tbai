import React from 'react';

export function Select({ label, options = [], value, onChange, placeholder = 'Choose one', disabled = false }) {
  return React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-body)', width: '100%' } },
    label && React.createElement('span', {
      style: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }
    }, label),
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('select', {
        value, onChange, disabled,
        style: {
          width: '100%',
          height: 44,
          padding: '0 36px 0 14px',
          fontSize: 'var(--text-base)',
          fontFamily: 'var(--font-body)',
          color: 'var(--color-text-primary)',
          background: disabled ? 'var(--paper-100)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          appearance: 'none',
          boxSizing: 'border-box',
          cursor: disabled ? 'not-allowed' : 'pointer',
        },
      },
        React.createElement('option', { value: '', disabled: true }, placeholder),
        options.map((opt) => React.createElement('option', { key: opt.value ?? opt, value: opt.value ?? opt }, opt.label ?? opt))
      ),
      React.createElement('span', {
        style: {
          position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: 'var(--color-text-muted)', fontSize: 10,
        }
      }, '▾')
    )
  );
}
