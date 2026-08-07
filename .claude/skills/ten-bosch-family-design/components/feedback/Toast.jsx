import React from 'react';

const icons = { success: '✓', warning: '!', danger: '✕', info: 'i' };
const tones = {
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
};

export function Toast({ tone = 'info', children, onClose }) {
  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '14px 16px', borderRadius: 'var(--radius-md)',
      background: 'var(--brown-800)', color: 'var(--paper-0)',
      boxShadow: 'var(--shadow-lg)', fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)', maxWidth: 360,
    }
  },
    React.createElement('span', {
      style: {
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: tones[tone], color: 'var(--paper-0)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700,
      }
    }, icons[tone]),
    React.createElement('span', { style: { flex: 1 } }, children),
    onClose && React.createElement('button', {
      onClick: onClose,
      style: { border: 'none', background: 'none', color: 'var(--paper-200)', cursor: 'pointer', fontSize: 16 }
    }, '×')
  );
}
