import React from 'react';

export function Checkbox({ label, checked = false, onChange, disabled = false }) {
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
        width: 22, height: 22, borderRadius: 'var(--radius-sm)',
        border: `1.5px solid ${checked ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
        background: checked ? 'var(--color-primary)' : 'var(--color-surface)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all var(--duration-base) var(--ease-standard)', flexShrink: 0,
      }
    }, checked && React.createElement('span', {
      style: { color: 'var(--paper-0)', fontSize: 14, lineHeight: 1 }
    }, '✓')),
    React.createElement('input', {
      type: 'checkbox', checked, onChange, disabled, style: { display: 'none' }
    }),
    label
  );
}
