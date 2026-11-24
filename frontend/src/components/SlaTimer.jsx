import { useEffect, useState } from 'react';

// Every support ticket must be solved within 48 hours of being raised
// (user ask 2026-11-24). Same rule as backend config/supportTickets.js —
// past it, Support gets an email (services/lms/automationRules.js).
export const TICKET_SLA_HOURS = 48;

const fmt = (ms) => {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60000));
  const h = Math.floor(m / 60);
  return h >= 1 ? `${h}h ${m % 60}m` : `${m}m`;
};

export default function SlaTimer({ created, slaDueAt, status, compact = false }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!created || status === 'Resolved') return compact ? null : <span style={{ color: '#64748b', fontSize: 12 }}>—</span>;
  const due = slaDueAt ? new Date(slaDueAt).getTime() : new Date(created).getTime() + TICKET_SLA_HOURS * 3600000;
  const left = due - now;
  const over = left < 0;
  const risk = !over && left < 12 * 3600000;
  const tone = over ? { bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' } : risk ? { bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' } : { bg: '#ecfdf5', fg: '#047857', bd: '#a7f3d0' };
  const label = over ? `Overdue ${fmt(left)}` : `${fmt(left)} left`;
  return (
    <span
      title={`Must be solved within ${TICKET_SLA_HOURS} hours — by ${new Date(due).toLocaleString()}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}
    >
      ⏱ {label}
    </span>
  );
}
