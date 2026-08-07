import React from 'react';

export function Dialog({ open, onClose, title, children, actions }) {
  if (!open) return null;
  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(34,23,18,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    },
    onClick: onClose,
  },
    React.createElement('div', {
      style: {
        background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)', padding: 28, width: 380, maxWidth: '90vw',
        fontFamily: 'var(--font-body)', color: 'var(--color-text-primary)',
      },
      onClick: (e) => e.stopPropagation(),
    },
      title && React.createElement('h3', {
        style: { fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 600, margin: '0 0 12px' }
      }, title),
      React.createElement('div', { style: { fontSize: 'var(--text-base)', lineHeight: 'var(--leading-normal)', color: 'var(--color-text-secondary)' } }, children),
      actions && React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 } }, actions)
    )
  );
}
