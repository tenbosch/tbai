import React from 'react';

export function Radio({ label, checked = false, onChange, name, disabled = false }) {
  return React.createElement(
    'label',
    {
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 10,
        fontFamily: 'var(--font-body)', fontSize: 'var(--text-base)',
        color: 'var(--color-text-primary)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }
    },
    React.createElement('span', {
      style: {
        width: 22, height: 22, borderRadius: '50%',
        border: `1.5px solid ${checked ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
        background: 'var(--color-surface)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all var(--duration-base) var(--ease-standard)', flexShrink: 0,
      }
    }, checked && React.createElement('span', {
      style: { width: 11, height: 11, borderRadius: '50%', background: 'var(--color-primary)' }
    })),
    React.createElement('input', {
      type: 'radio', checked, onChange, name, disabled, style: { display: 'none' }
    }),
    label
  );
}
