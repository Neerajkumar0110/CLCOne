import React from 'react';
import { Button, Dropdown } from 'antd';
import { MoreOutlined } from '@ant-design/icons';

// Row actions: the first `inline` actions stay as buttons, the rest go into
// one "⋮" menu, so a table row never turns into a wall of buttons.
// items: [{ key, label, icon, onClick, danger, disabled }]
export default function RowActions({ items = [], inline = 1, size = 'small' }) {
  const list = items.filter(Boolean);
  const shown = list.slice(0, inline);
  const rest = list.slice(inline);
  return (
    <span className="lu-row-actions">
      {shown.map((a) => (
        <Button key={a.key} size={size} icon={a.icon} danger={a.danger} disabled={a.disabled} onClick={a.onClick}>
          {a.label}
        </Button>
      ))}
      {rest.length > 0 && (
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          menu={{
            items: rest.map((a) => ({ key: a.key, label: a.label, icon: a.icon, danger: a.danger, disabled: a.disabled })),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation();
              const a = rest.find((x) => x.key === key);
              if (a && a.onClick) a.onClick();
            },
          }}
        >
          <Button size={size} icon={<MoreOutlined />} aria-label="More actions" title="More actions" onClick={(e) => e.stopPropagation()} />
        </Dropdown>
      )}
    </span>
  );
}
