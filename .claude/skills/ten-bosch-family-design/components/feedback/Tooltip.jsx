import React, { useState } from 'react';

export function Tooltip({ children, label, side = 'top' }) {
  const [open, setOpen] = useState(false);
  const pos = {
    top: { bottom: '120%', left: '50%', transform: 'translateX(-50%)' },
    bottom: { top: '120%', left: '50%', transform: 'translateX(-50%)' },
  }[side] || {};

  return React.createElement('span', {
    style: { position: 'relative', display: 'inline-flex' },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
  },
    children,
    open && React.createElement('span', {
      style: {
        position: 'absolute', ...pos,
        background: 'var(--brown-800)', color: 'var(--paper-0)',
        padding: '5px 10px', borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-body)', fontSize: 'var(--text-xs)', fontWeight: 500,
        whiteSpace: 'nowrap', boxShadow: 'var(--shadow-md)', zIndex: 10,
        pointerEvents: 'none',
      }
    }, label)
  );
}
