import React from 'react';

const tones = {
  neutral: { bg: 'var(--paper-100)', fg: 'var(--brown-700)' },
  primary: { bg: 'var(--color-primary-soft)', fg: 'var(--green-700)' },
  success: { bg: 'var(--color-success-soft)', fg: 'var(--green-700)' },
  warning: { bg: 'var(--color-warning-soft)', fg: 'var(--amber-500)' },
  danger: { bg: 'var(--color-danger-soft)', fg: 'var(--rust-500)' },
};

export function Badge({ children, tone = 'neutral' }) {
  const t = tones[tone] || tones.neutral;
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', fontWeight: 600,
      background: t.bg, color: t.fg, lineHeight: 1.4,
    }
  }, children);
}
