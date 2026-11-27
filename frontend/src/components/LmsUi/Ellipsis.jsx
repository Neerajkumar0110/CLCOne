import React from 'react';

// One-line text that ends in "…" when it doesn't fit; the global LMS tooltip
// (OverflowTooltip) shows the full text on hover. `lines` > 1 clamps instead.
export default function Ellipsis({ children, lines = 1, maxWidth, className = '', style, as: Tag = 'span' }) {
  return (
    <Tag className={`${lines > 1 ? 'lu-clamp' : 'lu-ellipsis'} ${className}`.trim()} style={{ maxWidth, ...(lines > 1 ? { WebkitLineClamp: lines } : null), ...style }}>
      {children}
    </Tag>
  );
}
