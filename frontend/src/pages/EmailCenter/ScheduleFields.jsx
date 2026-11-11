import React from 'react';
import dayjs from 'dayjs';
import { DatePicker, Input, InputNumber, Select } from 'antd';
import { ROLES } from '@/config/roles';

// When + to whom, for a custom email (Messenger › Email). Values match
// services/mail/emailSchedule.js on the server.
export const SCHEDULE_OPTIONS = [
  { value: 'once', label: 'Once — on a date and time' },
  { value: 'daily', label: 'Every day at a time' },
  { value: 'weekly', label: 'Every week on a day' },
  { value: 'after-enrolment', label: 'After a learner is enrolled' },
  { value: 'before-class', label: 'Before each live class' },
  { value: 'after-class', label: 'After each live class ends' },
];
export const AUDIENCE_OPTIONS = [
  { value: 'all-learners', label: 'All active learners' },
  { value: 'batch', label: 'Learners of one batch' },
  { value: 'role', label: 'Staff with a role' },
  { value: 'emails', label: 'These email addresses' },
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const UNITS = [
  { value: 1, label: 'minutes' },
  { value: 60, label: 'hours' },
  { value: 1440, label: 'days' },
];

function unitOf(min) {
  if (min && min % 1440 === 0) return 1440;
  if (min && min % 60 === 0) return 60;
  return 1;
}

export default function ScheduleFields({ schedule, audience, onChange }) {
  const s = schedule || { type: 'once' };
  const a = audience || { type: 'all-learners' };
  const setS = (patch) => onChange({ schedule: { ...s, ...patch }, audience: a });
  const setA = (patch) => onChange({ schedule: s, audience: { ...a, ...patch } });
  const offset = ['after-enrolment', 'before-class', 'after-class'].includes(s.type);
  const unit = unitOf(s.offsetMin);
  const learnersOnly = offset;

  return (
    <div className="ec-fields">
      <label className="ec-field">
        <span>When should it go?</span>
        <Select value={s.type} options={SCHEDULE_OPTIONS} onChange={(type) => setS({ type })} />
      </label>
      {s.type === 'once' && (
        <label className="ec-field">
          <span>Date and time</span>
          <DatePicker showTime={{ format: 'HH:mm' }} format="DD MMM YYYY, HH:mm" value={s.at ? dayjs(s.at) : null} onChange={(d) => setS({ at: d ? d.toISOString() : null })} />
        </label>
      )}
      {s.type === 'weekly' && (
        <label className="ec-field">
          <span>Day</span>
          <Select value={s.weekday ?? 1} options={DAYS.map((d, i) => ({ value: i, label: d }))} onChange={(weekday) => setS({ weekday })} />
        </label>
      )}
      {(s.type === 'daily' || s.type === 'weekly') && (
        <label className="ec-field">
          <span>Time (India)</span>
          <Input type="time" value={s.time || '09:00'} onChange={(e) => setS({ time: e.target.value })} />
        </label>
      )}
      {offset && (
        <label className="ec-field">
          <span>{s.type === 'before-class' ? 'How long before the class' : s.type === 'after-class' ? 'How long after the class ends' : 'How long after enrolment'}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <InputNumber min={0} value={Math.round((s.offsetMin || 0) / unit)} onChange={(n) => setS({ offsetMin: Math.max(0, Number(n) || 0) * unit })} style={{ width: 110 }} />
            <Select value={unit} options={UNITS} style={{ width: 120 }} onChange={(u) => setS({ offsetMin: Math.round((s.offsetMin || 0) / unit) * u })} />
          </div>
        </label>
      )}
      <label className="ec-field">
        <span>Who gets it?</span>
        <Select value={a.type} options={AUDIENCE_OPTIONS.filter((o) => !learnersOnly || ['all-learners', 'batch'].includes(o.value))} onChange={(type) => setA({ type, value: '' })} />
      </label>
      {a.type === 'batch' && (
        <label className="ec-field">
          <span>Batch name</span>
          <Input value={a.value} placeholder="Exactly as in Batches" onChange={(e) => setA({ value: e.target.value })} />
        </label>
      )}
      {a.type === 'role' && (
        <label className="ec-field">
          <span>Role</span>
          <Select value={a.value || undefined} placeholder="Pick a role" options={ROLES.map((r) => ({ value: r, label: r }))} onChange={(value) => setA({ value })} />
        </label>
      )}
      {a.type === 'emails' && (
        <label className="ec-field ec-span">
          <span>Email addresses (comma or new line)</span>
          <Input.TextArea rows={2} value={a.value} onChange={(e) => setA({ value: e.target.value })} />
        </label>
      )}
    </div>
  );
}
