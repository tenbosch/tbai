import React, { useState } from 'react';

export function Tabs({ tabs = [], defaultIndex = 0 }) {
  const [active, setActive] = useState(defaultIndex);
  return React.createElement('div', { style: { fontFamily: 'var(--font-body)' } },
    React.createElement('div', {
      style: { display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)' }
    }, tabs.map((t, i) => React.createElement('button', {
      key: t.label,
      onClick: () => setActive(i),
      style: {
        padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
        fontSize: 'var(--text-sm)', fontWeight: 600,
        color: i === active ? 'var(--color-primary)' : 'var(--color-text-muted)',
        borderBottom: i === active ? '2px solid var(--color-primary)' : '2px solid transparent',
        marginBottom: -1, transition: 'color var(--duration-base) var(--ease-standard)',
      }
    }, t.label))),
    React.createElement('div', { style: { padding: '16px 0', color: 'var(--color-text-primary)' } }, tabs[active]?.content)
  );
}
