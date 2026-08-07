import React from 'react';

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  onClick,
  type = 'button',
}) {
  const sizes = {
    sm: { padding: '6px 14px', fontSize: 'var(--text-sm)', gap: 6, height: 34 },
    md: { padding: '10px 18px', fontSize: 'var(--text-base)', gap: 8, height: 44 },
    lg: { padding: '13px 24px', fontSize: 'var(--text-md)', gap: 10, height: 52 },
  };

  const variants = {
    primary: {
      background: 'var(--color-primary)',
      color: 'var(--color-text-on-primary)',
      border: '1px solid transparent',
    },
    secondary: {
      background: 'var(--color-accent-soft)',
      color: 'var(--brown-700)',
      border: '1px solid transparent',
    },
    outline: {
      background: 'transparent',
      color: 'var(--color-primary)',
      border: '1px solid var(--color-border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--color-text-primary)',
      border: '1px solid transparent',
    },
    danger: {
      background: 'var(--color-danger)',
      color: 'var(--paper-0)',
      border: '1px solid transparent',
    },
  };

  const s = sizes[size];
  const v = variants[variant];

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s.gap,
    height: s.height,
    padding: s.padding,
    fontSize: s.fontSize,
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--duration-base) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)',
    ...v,
  };

  return React.createElement(
    'button',
    {
      type,
      disabled,
      onClick,
      style,
      onMouseDown: (e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.98)'; },
      onMouseUp: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
      onMouseLeave: (e) => { e.currentTarget.style.transform = 'scale(1)'; },
    },
    icon || null,
    children
  );
}
