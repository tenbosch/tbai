import React from 'react';

export function Input({ label, placeholder, value, onChange, type = 'text', helpText, error, disabled = false, icon }) {
  return React.createElement(
    'label',
    { style: { display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-body)', width: '100%' } },
    label && React.createElement('span', {
      style: { fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }
    }, label),
    React.createElement('div', {
      style: { position: 'relative', display: 'flex', alignItems: 'center' }
    },
      icon && React.createElement('span', {
        style: { position: 'absolute', left: 12, display: 'flex', color: 'var(--color-text-muted)' }
      }, icon),
      React.createElement('input', {
        type, placeholder, value, onChange, disabled,
        style: {
          width: '100%',
          height: 44,
          padding: icon ? '0 14px 0 38px' : '0 14px',
          fontSize: 'var(--text-base)',
          fontFamily: 'var(--font-body)',
          color: 'var(--color-text-primary)',
          background: disabled ? 'var(--paper-100)' : 'var(--color-surface)',
          border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          boxSizing: 'border-box',
          transition: 'border-color var(--duration-base) var(--ease-standard)',
        },
        onFocus: (e) => { e.target.style.borderColor = 'var(--color-focus-ring)'; },
        onBlur: (e) => { e.target.style.borderColor = error ? 'var(--color-danger)' : 'var(--color-border)'; },
      })
    ),
    (helpText || error) && React.createElement('span', {
      style: { fontSize: 'var(--text-xs)', color: error ? 'var(--color-danger)' : 'var(--color-text-muted)' }
    }, error || helpText)
  );
}
