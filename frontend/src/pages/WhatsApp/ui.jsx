import React from 'react';
import { Modal } from 'antd';
import { WhatsAppOutlined, SearchOutlined } from '@ant-design/icons';

// WhatsApp pop-up. antd's Modal only gives the overlay + box; header, body
// and footer are our own markup (classes wa-dlg-*, whatsapp.css), so the
// global antd modal overrides can't squash the spacing (they did 2026-11-14).
export function WaDialog({ open, onClose, icon, title, subtitle, children, okText = 'Save', okIcon, onOk, okDisabled, loading, width = 500 }) {
  return (
    <Modal rootClassName="wa-modal" open={open} onCancel={onClose} footer={null} title={null} width={width} centered destroyOnClose>
      <div className="wa-dlg-head">
        {icon && <span className="wa-dlg-icon">{icon}</span>}
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!okDisabled && !loading) onOk?.();
        }}
      >
        <div className="wa-dlg-body">{children}</div>
        <div className="wa-dlg-foot">
          <button type="button" className="wa-btn wa-btn-default" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="wa-btn wa-btn-primary" disabled={okDisabled || loading}>
            {loading ? <span className="wa-spinner" aria-hidden="true" /> : okIcon}
            {okText}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Small building blocks that reproduce the approved design
// (claude.ai/artifact/6Js2ZwbWVZ7psJfoSqdo3n) — styles in whatsapp.css.

const AVATAR_COLORS = ['#1d4ed8', '#7c3aed', '#0f766e', '#b45309', '#be185d', '#475569'];

export const initials = (name) =>
  String(name || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Avatar({ id, name, size = 36 }) {
  const s = String(id || name || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (
    <span className="wa-avatar" style={{ width: size, height: size, fontSize: size < 36 ? 12 : 13, background: AVATAR_COLORS[h % AVATAR_COLORS.length] }}>
      {initials(name)}
    </span>
  );
}

export function PageHeader({ actions }) {
  return (
    <div className="wa-head">
      <div className="wa-head-left">
        <div className="wa-head-icon" aria-hidden="true">
          <WhatsAppOutlined />
        </div>
        <div>
          <div className="wa-head-crumb">Messenger › WhatsApp</div>
          <h1 className="wa-head-title">WhatsApp</h1>
        </div>
      </div>
      {actions ? <div className="wa-head-actions">{actions}</div> : null}
    </div>
  );
}

export const Btn = React.forwardRef(function Btn({ variant = 'default', size, icon, children, loading, className = '', disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`wa-btn wa-btn-${variant} ${size === 'sm' ? 'wa-btn-sm' : ''} ${className}`}
      disabled={loading || disabled}
      {...rest}
    >
      {loading ? <span className="wa-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

// Underline tabs at the top of a card.
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="wa-tabbar" role="tablist">
      {tabs.map((t) => (
        <button
          type="button"
          role="tab"
          key={t.key}
          aria-selected={value === t.key}
          className={`wa-tab ${value === t.key ? 'active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count != null && <span className="wa-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, label, style }) {
  return (
    <label className="wa-search" style={style}>
      <SearchOutlined aria-hidden="true" />
      <span className="wa-sr">{label || placeholder}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function FilterPills({ options, value, onChange }) {
  return (
    <div className="wa-pills">
      {options.map((o) => (
        <button type="button" key={o} className={`wa-filter ${value === o ? 'active' : ''}`} aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// 2–3 option control. `tone` per option colours the selected state.
export function ModeSwitch({ options, value, onChange, size }) {
  return (
    <div className={`wa-seg ${size === 'lg' ? 'wa-seg-lg' : ''}`}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={value === o.value}
          className={`wa-seg-btn ${value === o.value ? `on tone-${o.tone || 'dark'}` : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" className={`wa-toggle ${checked ? 'on' : ''}`} aria-pressed={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span className="wa-toggle-knob" />
    </button>
  );
}

export function RoleChip({ checked, onChange, children }) {
  return (
    <button type="button" className={`wa-chip ${checked ? 'on' : ''}`} aria-pressed={checked} onClick={() => onChange(!checked)}>
      <span className="wa-chip-box" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      </span>
      {children}
    </button>
  );
}

const DEVICE = {
  connected: ['Connected', 'green'],
  connecting: ['Waiting for QR scan', 'amber'],
  disconnected: ['Disconnected', 'red'],
};
export function DeviceTag({ status }) {
  const [label, tone] = DEVICE[status] || ['Not set up', 'gray'];
  return <span className={`wa-tag tone-${tone}`}>{label}</span>;
}
export const deviceDot = (status) =>
  ({ connected: ['Online', '#16a34a'], connecting: ['Waiting for QR scan', '#d97706'], disconnected: ['Disconnected', '#dc2626'] })[status] || [
    'Not set up',
    '#9ca3af',
  ];

export function Notice({ tone = 'green', title, children }) {
  return (
    <div className={`wa-notice tone-${tone}`}>
      {title && <b>{title} </b>}
      {children}
    </div>
  );
}
