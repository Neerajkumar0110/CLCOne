import React, { useEffect, useState } from 'react';
import api from '../api';
import { B, ErrorState, Skeleton, Toggle, dateLabel, useLoad, useToast } from '../ui';

// A10 · Attendance settings — nothing is hard-coded; every change is audited.
const toHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Settings({ onSaved }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api.get('admin/settings'), []);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hol, setHol] = useState({ name: '', date: '' });
  useEffect(() => {
    if (data) setS(JSON.parse(JSON.stringify(data.settings)));
  }, [data]);
  if (loading && !data) return <Skeleton rows={8} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  if (!s) return null;
  const up = (k, v) => setS({ ...s, [k]: v });
  const upR = (k, v) => setS({ ...s, rules: { ...s.rules, [k]: v } });
  const save = async () => {
    const req = fromHM(s._required ?? toHM(s.requiredMin));
    const lunch = fromHM(s._lunch ?? toHM(s.lunchMin));
    const inact = fromHM(s._inact ?? toHM(s.inactivitySec)); // MM:SS → seconds
    if (req == null || lunch == null || inact == null) return toast.err('Use HH:MM for hours and durations');
    const body = { ...s, requiredMin: req, lunchMin: lunch, inactivitySec: inact };
    ['_required', '_lunch', '_inact'].forEach((k) => delete body[k]);
    setBusy(true);
    const r = await api.put('admin/settings', { settings: body });
    setBusy(false);
    toast.res(r, 'Settings saved');
    if (r.success) {
      onSaved && onSaved(r.result);
      reload(true);
    }
  };
  const addHoliday = async () => {
    const r = await api.post('admin/holidays', hol);
    toast.res(r, 'Holiday added');
    if (r.success) {
      setHol({ name: '', date: '' });
      reload(true);
    }
  };
  const removeHoliday = async (h) => {
    if (!window.confirm(`Remove ${h.name}?`)) return;
    const r = await api.post(`admin/holidays/${h._id}/remove`, {});
    toast.res(r, 'Holiday removed');
    if (r.success) reload(true);
  };
  const R = s.rules;
  const ruleInp = (k) => <input className="e-fld" value={toHM(R[k])} onChange={(e) => fromHM(e.target.value) != null && upR(k, fromHM(e.target.value))} aria-label={k} />;
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Attendance settings</h1>
          <p className="e-sub">Nothing is hard-coded. Changes apply from now and are saved in the audit log.</p>
        </div>
        <div className="e-row">
          <button type="button" className="e-btn" onClick={() => setS(JSON.parse(JSON.stringify(data.settings)))}>
            Discard
          </button>
          <button type="button" className="e-btn p" disabled={busy} onClick={save}>
            Save settings
          </button>
        </div>
      </div>
      <div className="e-grid e-g2" style={{ alignItems: 'start' }}>
        <section className="e-card pad">
          <h2 className="e-ct">Working hours</h2>
          <p className="e-cs" style={{ marginBottom: 16 }}>
            Shift: General
          </p>
          <div className="e-fgrid">
            <label>
              <span className="e-lbl">Work start time</span>
              <input className="e-fld" type="time" value={s.workStart} onChange={(e) => up('workStart', e.target.value)} />
            </label>
            <label>
              <span className="e-lbl">Work end time</span>
              <input className="e-fld" type="time" value={s.workEnd} onChange={(e) => up('workEnd', e.target.value)} />
            </label>
            <label>
              <span className="e-lbl">Daily required hours</span>
              <input className="e-fld" value={s._required ?? toHM(s.requiredMin)} onChange={(e) => up('_required', e.target.value)} />
              <span className="e-hint">actual active work (HH:MM)</span>
            </label>
            <label>
              <span className="e-lbl">Late login after</span>
              <input className="e-fld" type="time" value={s.lateAfter} onChange={(e) => up('lateAfter', e.target.value)} />
              <span className="e-hint">{Math.max(0, (fromHM(s.lateAfter) || 0) - (fromHM(s.workStart) || 0))} min grace</span>
            </label>
            <label>
              <span className="e-lbl">Lunch duration</span>
              <input className="e-fld" value={s._lunch ?? toHM(s.lunchMin)} onChange={(e) => up('_lunch', e.target.value)} />
            </label>
            <label>
              <span className="e-lbl">Lunch window</span>
              <div className="e-row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                <input className="e-fld" type="time" value={s.lunchWindowStart} onChange={(e) => up('lunchWindowStart', e.target.value)} />
                <input className="e-fld" type="time" value={s.lunchWindowEnd} onChange={(e) => up('lunchWindowEnd', e.target.value)} />
              </div>
              <span className="e-hint">auto-starts at {s.lunchWindowStart} if not started</span>
            </label>
          </div>
          <div style={{ marginTop: 16 }}>
            <span className="e-lbl">Short breaks</span>
            {s.breaks.map((b, i) => (
              <div key={b.key} className="e-rule">
                <input className="e-fld" style={{ flex: 1, width: 'auto' }} value={b.label} onChange={(e) => up('breaks', s.breaks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Break name" />
                <input className="e-fld" type="time" value={b.start} onChange={(e) => up('breaks', s.breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label="Break time" />
                <input className="e-fld" type="number" min="1" value={b.min} onChange={(e) => up('breaks', s.breaks.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} aria-label="Minutes" />
                <span style={{ fontSize: 12, color: 'var(--e-mut)' }}>min</span>
                <button type="button" className="e-btn sm d" onClick={() => up('breaks', s.breaks.filter((_, j) => j !== i))} aria-label="Remove break">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="e-btn sm" style={{ marginTop: 10 }} onClick={() => up('breaks', [...s.breaks, { key: `b${Date.now()}`, label: `Tea break ${s.breaks.length + 1}`, start: '16:30', min: 10 }])}>
              + Add break
            </button>
          </div>
        </section>
        <section className="e-card pad">
          <h2 className="e-ct">Activity tracking</h2>
          <p className="e-cs" style={{ marginBottom: 16 }}>
            Only presence is tracked. Keys, text and screens are never captured.
          </p>
          <div className="e-fgrid">
            <label>
              <span className="e-lbl">Inactivity threshold</span>
              <input className="e-fld" value={s._inact ?? toHM(s.inactivitySec)} onChange={(e) => up('_inact', e.target.value)} />
              <span className="e-hint">MM:SS without mouse / keyboard / touch</span>
            </label>
            <label>
              <span className="e-lbl">Heartbeat every (sec)</span>
              <input className="e-fld" type="number" min="10" max="120" value={s.heartbeatSec} onChange={(e) => up('heartbeatSec', Number(e.target.value))} />
            </label>
            <label>
              <span className="e-lbl">Offline after no heartbeat (sec)</span>
              <input className="e-fld" type="number" min="60" max="900" value={s.offlineSec} onChange={(e) => up('offlineSec', Number(e.target.value))} />
            </label>
            <label>
              <span className="e-lbl">Auto-close open sessions</span>
              <input className="e-fld" type="time" value={s.autoCloseAt} onChange={(e) => up('autoCloseAt', e.target.value)} />
              <span className="e-hint">marked Needs review</span>
            </label>
          </div>
          {[
            ['countScrollTouch', 'Count scroll and touch as activity'],
            ['inactiveBanner', 'Show the employee a "You are inactive" banner'],
            ['autoLunch', 'Start lunch on its own at the lunch window'],
            ['pauseDialerOnInactive', 'Pause auto-dialer when a Sales user goes Inactive'],
            ['allowSecondDevice', 'Allow re-login on a second device (owner / Teacher only)'],
          ].map(([k, l]) => (
            <div key={k} className="e-rule" style={k === 'allowSecondDevice' ? { borderBottom: 0 } : undefined}>
              <span style={{ flex: 1 }}>{l}</span>
              <Toggle on={!!s[k]} onChange={(v) => up(k, v)} label={l} />
            </div>
          ))}
        </section>
        <section className="e-card pad">
          <h2 className="e-ct">Status rules</h2>
          <p className="e-cs" style={{ marginBottom: 16 }}>
            Checked at shift end and again at midnight. Top rule wins.
          </p>
          <div className="e-rule">
            <B>Absent</B>
            <span style={{ flex: 1 }}>no login and no approved leave</span>
          </div>
          <div className="e-rule">
            <B>Incomplete</B>
            <span style={{ flex: 1 }}>no logout by auto-close time (shown as Needs review)</span>
          </div>
          <div className="e-rule">
            <B>Half Day</B>
            <span style={{ flex: 1 }}>actual work between</span>
            {ruleInp('halfMin')}
            <span>and</span>
            {ruleInp('halfMax')}
          </div>
          <div className="e-rule">
            <B>Short</B>
            <span style={{ flex: 1 }}>actual work between</span>
            {ruleInp('shortMin')}
            <span>and</span>
            {ruleInp('shortMax')}
          </div>
          <div className="e-rule">
            <B>Present</B>
            <span style={{ flex: 1 }}>actual work at least</span>
            {ruleInp('presentMin')}
          </div>
          <div className="e-rule">
            <B>Late</B>
            <span style={{ flex: 1 }}>extra tag when login is after the late time</span>
          </div>
          <div className="e-rule" style={{ borderBottom: 0 }}>
            <B>Early Logout</B>
            <span style={{ flex: 1 }}>extra tag when logout is before end time</span>
          </div>
        </section>
        <section className="e-card pad">
          <h2 className="e-ct">Week, holidays &amp; leave types</h2>
          <p className="e-cs" style={{ marginBottom: 16 }}>
            Weekly offs and holidays are never counted as Absent.
          </p>
          <span className="e-lbl">Weekly off</span>
          <div className="e-row" style={{ gap: 6 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button key={d} type="button" className={`e-wd${s.weeklyOff.includes(d) ? ' on' : ''}`} aria-pressed={s.weeklyOff.includes(d)} onClick={() => up('weeklyOff', s.weeklyOff.includes(d) ? s.weeklyOff.filter((x) => x !== d) : [...s.weeklyOff, d])}>
                {DOW[d]}
              </button>
            ))}
          </div>
          <div className="e-row" style={{ marginTop: 16 }}>
            <span className="e-lbl" style={{ flex: 1, margin: 0 }}>
              Holidays
            </span>
          </div>
          {data.holidays.map((h) => (
            <div key={h._id} className="e-rule">
              <span style={{ flex: 1 }}>{h.name}</span>
              <span style={{ color: 'var(--e-mut)' }}>{dateLabel(h.date)}</span>
              <button type="button" className="e-btn sm d" onClick={() => removeHoliday(h)} aria-label={`Remove ${h.name}`}>
                ✕
              </button>
            </div>
          ))}
          <div className="e-row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
            <input className="e-fld" placeholder="Holiday name" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} />
            <input className="e-fld" type="date" style={{ width: 160 }} value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} />
            <button type="button" className="e-btn sm" disabled={!hol.name || !hol.date} onClick={addHoliday}>
              + Add
            </button>
          </div>
          <span className="e-lbl" style={{ marginTop: 16 }}>
            Leave types · days per year
          </span>
          <div className="e-fgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))' }}>
            {Object.keys(s.leaveQuota).map((t) => (
              <label key={t}>
                <span className="e-lbl">{t}</span>
                <input className="e-fld" type="number" min="0" value={s.leaveQuota[t]} onChange={(e) => up('leaveQuota', { ...s.leaveQuota, [t]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
        </section>
        <section className="e-card pad">
          <h2 className="e-ct">Leave emails &amp; approvers</h2>
          <p className="e-cs" style={{ marginBottom: 16 }}>
            Recipients live in the backend .env and are only shown here, never sent to the browser in full.
          </p>
          <div className="e-rule">
            <span style={{ flex: 1 }}>LEAVE_ADMIN_EMAIL (Career Lab HR)</span>
            <code style={{ fontSize: 12, background: 'var(--e-line2)', padding: '3px 8px', borderRadius: 6 }}>{data.env.admin ? data.recipients[0] || 'set' : 'not set'}</code>
          </div>
          <div className="e-rule">
            <span style={{ flex: 1 }}>LEAVE_NOTIFICATION_EMAIL</span>
            <code style={{ fontSize: 12, background: 'var(--e-line2)', padding: '3px 8px', borderRadius: 6 }}>{data.env.notification ? data.recipients[data.recipients.length - 1] || 'set' : 'not set'}</code>
          </div>
          <div className="e-rule">
            <span style={{ flex: 1 }}>Email the employee on approve / reject</span>
            <Toggle on={!!s.emailEmployee} onChange={(v) => up('emailEmployee', v)} label="Email the employee" />
          </div>
          <div className="e-rule">
            <span style={{ flex: 1 }}>Who can approve</span>
            <span style={{ color: 'var(--e-mut)' }}>Owner, Admins, Sales/Team Manager + HR Admin</span>
          </div>
          <div className="e-rule" style={{ borderBottom: 0 }}>
            <span style={{ flex: 1 }}>Templates</span>
            <a href="/messenger/email">Edit in Messenger › Email →</a>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className="e-lbl">Departments</span>
            <input className="e-fld" value={s.departments.join(', ')} onChange={(e) => up('departments', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />
          </div>
        </section>
      </div>
    </div>
  );
}
