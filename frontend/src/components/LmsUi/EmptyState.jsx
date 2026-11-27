import React from 'react';
import { InboxOutlined, SearchOutlined } from '@ant-design/icons';

// The one "nothing here" block for the LMS. Used by antd's renderEmpty
// (every Table / List with no rows) and directly by screens.
export default function EmptyState({ title = 'No data found', text = 'There are no records to show here yet.', icon, action, compact = false }) {
  return (
    <div className={`lu-empty${compact ? ' compact' : ''}`} role="status">
      <span className="lu-empty-icon" aria-hidden="true">{icon || <InboxOutlined />}</span>
      <div className="lu-empty-title">{title}</div>
      {text ? <div className="lu-empty-text">{text}</div> : null}
      {action ? <div className="lu-empty-action">{action}</div> : null}
    </div>
  );
}

export function renderEmpty(componentName) {
  if (componentName === 'Select' || componentName === 'TreeSelect' || componentName === 'Cascader' || componentName === 'Transfer' || componentName === 'AutoComplete') {
    return <div className="lu-empty-mini"><SearchOutlined /> No matches</div>;
  }
  return <EmptyState compact={componentName !== 'Table'} title="No data found" text="Nothing matches here yet — try another filter or date." />;
}
