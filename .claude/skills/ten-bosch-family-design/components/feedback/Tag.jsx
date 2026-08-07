import React from 'react';

export function Tag({ children, onRemove, color }) {
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 10px 5px 12px', borderRadius: 'var(--radius-sm)',
      fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)', fontWeight: 500,
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      color: color || 'var(--color-text-primary)',
    }
  },
    children,
    onRemove && React.createElement('button', {
      onClick: onRemove,
      style: {
        border: 'none', background: 'none', cursor: 'pointer', padding: 0,
        color: 'var(--color-text-muted)', fontSize: 14, lineHeight: 1, display: 'flex',
      }
    }, '×')
  );
}
