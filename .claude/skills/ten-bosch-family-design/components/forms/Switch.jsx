import React from 'react';

export function Switch({ label, checked = false, onChange, disabled = false }) {
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
        width: 42, height: 24, borderRadius: 'var(--radius-pill)',
        background: checked ? 'var(--color-primary)' : 'var(--paper-200)',
        position: 'relative', flexShrink: 0,
        transition: 'background var(--duration-base) var(--ease-standard)',
      }
    }, React.createElement('span', {
      style: {
        position: 'absolute', top: 3, left: checked ? 21 : 3,
        width: 18, height: 18, borderRadius: '50%', background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-xs)', transition: 'left var(--duration-base) var(--ease-standard)',
      }
    })),
    React.createElement('input', {
      type: 'checkbox', checked, onChange, disabled, style: { display: 'none' }
    }),
    label
  );
}
