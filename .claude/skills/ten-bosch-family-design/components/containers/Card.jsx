import React from 'react';

export function Card({ children, arch = false, padding = 'md' }) {
  const paddings = { sm: 14, md: 20, lg: 28 };
  return React.createElement('div', {
    style: {
      background: 'var(--color-surface-warm)',
      border: '1px solid var(--color-border)',
      borderRadius: arch
        ? 'var(--radius-arch) var(--radius-arch) var(--radius-md) var(--radius-md)'
        : 'var(--radius-lg)',
      boxShadow: 'var(--shadow-sm)',
      padding: paddings[padding] ?? paddings.md,
      fontFamily: 'var(--font-body)',
      color: 'var(--color-text-primary)',
    }
  }, children);
}
