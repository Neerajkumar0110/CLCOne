import React, { useState } from 'react';
import api from '../api';
import { Av, B, Bar, Card, ErrorState, Skeleton, StatusBadges, addDays, clock, dateLabel, hm, todayKey, useErpLive, useLoad, useToast } from '../ui';

// A4 · Attendance detail — day bar, timeline, totals, signals, correction.
const COLORS = { ACTIVE: '#16A34A', INACTIVE: '#F59E0B', LUNCH: '#8B5CF6', BREAK: '#8B5CF6', OFFLINE: '#CBD5E1' };
const BADGE = { ACTIVE: 'g', INACTIVE: 'a', LUNCH: 'v', BREAK: 'v', OFFLINE: 'o' };
const TITLE = { ACTIVE: 'Active', INACTIVE: 'Inactive', LUNCH: 'Lunch', BREAK: 'Break', OFFLINE: 'Offline' };
const durTxt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`);

export default function Detail({ adminId, date, onBack, onDate }) {
  const toast = useToast();
  const dk = date || todayKey();
  const { data, loading, error, reload } = useLoad(() => api.get(`admin/attendance/${adminId}/day`, { date: dk }), [adminId, dk], { poll: dk === todayKey() ? 30000 : 0 });
  useErpLive(() => dk === todayKey() && reload(true));
  const [f, setF] = useState({ field: 'logout', value: '', reason: '' });
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Skeleton rows={8} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const d = data;
  const e = d.employee;
  const s = d.session;
  const t = d.totals;
  // day bar range: from min(09:00, login) to max(19:00, logout/now)
  const H = (x) => Number(clock(x).slice(0, 2));
  const h0 = Math.min(9, s && s.loginAt ? H(s.loginAt) : 9);
  const lastEnd = d.periods.reduce((mx, p) => Math.max(mx, new Date(p.endAt || Date.now()).getTime()), 0);
  const h1 = Math.max(19, lastEnd ? H(new Date(lastEnd)) + 1 : 19);
  const base = new Date(`${dk}T${String(h0).padStart(2, '0')}:00:00+05:30`).getTime();
  const span = (h1 - h0) * 3600e3;
  const pos = (x) => Math.max(0, Math.min(100, ((new Date(x).getTime() - base) / span) * 100));
  const ticks = [];
  for (let h = h0; h <= h1; h += 2) ticks.push(`${String(h).padStart(2, '0')}:00`);
  const shortBy = Math.max(0, d.required - t.work);
  const save = async () => {
    setBusy(true);
    const r = await api.post('admin/attendance/correct', { adminId, date: dk, ...f });
    setBusy(false);
    toast.res(r, 'Correction saved');
    if (r.success) {
      setF({ ...f, value: '', reason: '' });
      reload(true);
    }
  };
  const placeholder = { logout: 'HH:MM e.g. 18:59', login: 'HH:MM e.g. 09:40', lunch: 'HH:MM-HH:MM e.g. 13:00-14:00', status: '' }[f.field];
  return (
    <div className="e-page">
      <button type="button" className="e-btn ghost" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={onBack}>
        ← Back to attendance
      </button>
      <section className="e-card pad e-row" style={{ gap: 16 }}>
        <Av name={e.name} size={52} photo={e.photo} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="e-row" style={{ gap: 10 }}>
            <h1 style={{ fontSize: 20 }}>{e.name}</h1>
            <StatusBadges status={d.status === 'Short' ? `Short · ${shortBy} min` : d.status} tags={d.tags} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--e-mut)', marginTop: 4 }}>{[e.employeeCode, e.department, e.designation, `${e.shiftName || 'General'} shift ${d.settings.workStart}–${d.settings.workEnd}`].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="e-row" style={{ gap: 6 }}>
          <button type="button" className="e-btn sm" aria-label="Previous day" onClick={() => onDate(addDays(dk, -1))}>
            ‹
          </button>
          <label className="e-inp">
            <input type="date" value={dk} max={todayKey()} onChange={(ev) => ev.target.value && onDate(ev.target.value)} aria-label="Day" />
          </label>
          <button type="button" className="e-btn sm" aria-label="Next day" disabled={dk >= todayKey()} onClick={() => onDate(addDays(dk, 1))}>
            ›
          </button>
        </div>
      </section>

      <section className="e-card pad">
        <div className="e-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <b style={{ fontSize: 13 }}>Day at a glance · {dateLabel(dk, { weekday: true })}</b>
          <span className="e-lg">
            <span>
              <i style={{ background: '#16A34A' }} />
              Active
            </span>
            <span>
              <i style={{ background: '#F59E0B' }} />
              Inactive
            </span>
            <span>
              <i style={{ background: '#8B5CF6' }} />
              Lunch / Break
            </span>
            <span>
              <i style={{ background: '#CBD5E1' }} />
              Offline
            </span>
          </span>
        </div>
        <div className="e-daybar" role="img" aria-label="Periods of the day">
          {d.periods.map((p) => (
            <i key={p._id} title={`${TITLE[p.type]} ${clock(p.startAt)}–${p.endAt ? clock(p.endAt) : 'now'}`} style={{ left: `${pos(p.startAt)}%`, width: `${Math.max(0.3, pos(p.endAt || Date.now()) - pos(p.startAt))}%`, background: COLORS[p.type] }} />
          ))}
        </div>
        <div className="e-row" style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--e-mut)', marginTop: 6 }}>
          {ticks.map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      </section>

      <div className="e-split">
        <Card className="main" title="Timeline" sub="Every period comes from server time. Gaps over 2 min without a heartbeat show as Offline.">
          {!s && <p className="e-cs">{d.status === 'Leave' ? `On leave (${d.leave && d.leave.leaveType}).` : d.status === 'Holiday' ? `Holiday — ${d.holiday}.` : d.status === 'Weekly Off' ? 'Weekly off.' : 'No attendance this day.'}</p>}
          {d.timeline.map((it, i) => {
            const last = i === d.timeline.length - 1;
            const isP = !!TITLE[it.kind];
            const c = isP ? COLORS[it.kind] : it.kind === 'review' ? '#DC2626' : 'var(--e-ink)';
            let note = it.note || '';
            if (isP) note = `${clock(it.at)} – ${it.open ? 'now' : clock(it.end)}`;
            if (it.kind === 'INACTIVE') note = `No mouse or keyboard from ${clock(it.lastInputAt)}. Counted from ${clock(it.at)}; ${it.open ? 'still inactive' : `resumed ${clock(it.end)}`}${it.laptop ? ` · ${it.laptop}` : ''}${it.countedAsWork ? ` · counted as work by ${it.countedBy}: ${it.countedReason}` : ''}${it.employeeNote ? ` · note: “${it.employeeNote}”` : ''}`;
            if (it.kind === 'LUNCH' || it.kind === 'BREAK') note += it.auto ? ' · started on schedule' : '';
            return (
              <div key={i} className="e-tl">
                <div className="t">{clock(it.at)}</div>
                <div className="dots">
                  <span className="dot" style={{ borderColor: c }} />
                  {!last && <span className="ln" />}
                </div>
                <div className="c">
                  <div className="e-row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{isP ? (it.kind === 'LUNCH' || it.kind === 'BREAK' ? it.label || TITLE[it.kind] : TITLE[it.kind]) : it.title}</span>
                    {isP && <B kind={BADGE[it.kind]}>{durTxt(it.minutes)}</B>}
                  </div>
                  {note && <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 3 }}>{note}</div>}
                </div>
              </div>
            );
          })}
        </Card>
        <div className="side">
          <section className="e-card pad">
            <h2 className="e-ct" style={{ marginBottom: 8 }}>
              Totals
            </h2>
            <div className="e-tot">
              <span>Total session</span>
              <b>{hm(t.session)}</b>
            </div>
            <div className="e-tot">
              <span>Lunch {t.break ? '+ breaks' : ''}</span>
              <b style={{ color: '#6D28D9' }}>− {hm(t.lunch + t.break)}</b>
            </div>
            <div className="e-tot">
              <span>Inactive</span>
              <b style={{ color: '#B45309' }}>− {hm(t.inactive)}</b>
            </div>
            <div className="e-tot">
              <span>Offline gaps</span>
              <b>− {hm(t.offline)}</b>
            </div>
            <div className="e-tot" style={{ borderBottom: 0, paddingTop: 12 }}>
              <span style={{ fontWeight: 600, color: 'var(--e-ink)' }}>Actual work</span>
              <b style={{ fontSize: 18 }}>{hm(t.work)}</b>
            </div>
            <Bar pct={(t.work / d.required) * 100} h={8} color={t.work >= d.required ? '#16A34A' : '#4F46E5'} style={{ margin: '6px 0 10px' }} />
            <div className="e-row" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--e-mut)' }}>
              <span>Required {hm(d.required)}</span>
              <span style={{ color: shortBy ? '#B91C1C' : '#15803D', fontWeight: 600 }}>{shortBy ? `Remaining ${hm(shortBy)}` : 'Target met ✓'}</span>
            </div>
          </section>
          <section className="e-card pad">
            <h2 className="e-ct">Session &amp; signals</h2>
            <p className="e-cs" style={{ marginBottom: 12 }}>
              Presence only. Keys, text and screens are never stored.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, fontSize: 12, color: 'var(--e-mut)' }}>
              <div>
                Mouse activity<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 14 }}>{d.signals.msBeats ? `yes in ${d.signals.msBeats} of ${d.signals.totalBeats} pings` : '—'}</b>
              </div>
              <div>
                Keyboard activity<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 14 }}>{d.signals.kbBeats ? `yes in ${d.signals.kbBeats} pings` : '—'}</b>
              </div>
              <div>
                Device<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 14 }}>{s && s.device ? [s.device.browser, s.device.os].filter(Boolean).join(' · ') : '—'}</b>
              </div>
              <div>
                Desktop agent<b style={{ display: 'block', color: 'var(--e-ink)', fontSize: 14 }}>{d.device ? `${d.device.hostname || 'Laptop'} · v${d.device.agentVersion || '?'}` : 'Not installed'}</b>
              </div>
            </div>
          </section>
          <section className="e-card pad">
            <h2 className="e-ct">Correct attendance</h2>
            <p className="e-cs" style={{ marginBottom: 14 }}>
              Only Attendance ERP admins can see this. The old and new values are saved in the audit log.
            </p>
            {!s && <div className="e-note info" style={{ marginBottom: 12 }}>No attendance this day — use “+ Manual attendance” or “Mark leave” on the Attendance tab.</div>}
            {s && s.status === 'needs_review' && <div className="e-note err" style={{ marginBottom: 12 }}>Session not closed{s.lastHeartbeatAt ? ` (last sign of life ${clock(s.lastHeartbeatAt)})` : ''}. Set the logout time to close it.{s.reviewNote ? ` Employee's note: “${s.reviewNote}”` : ''}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
              <label>
                <span className="e-lbl">Change</span>
                <select className="e-fld" value={f.field} onChange={(ev) => setF({ ...f, field: ev.target.value, value: '' })}>
                  <option value="logout">Logout time</option>
                  <option value="login">Login time</option>
                  <option value="lunch">Lunch period</option>
                  <option value="status">Status</option>
                </select>
              </label>
              <label>
                <span className="e-lbl">New value</span>
                {f.field === 'status' ? (
                  <select className="e-fld" value={f.value} onChange={(ev) => setF({ ...f, value: ev.target.value })}>
                    <option value="">Pick</option>
                    {['Present', 'Short', 'Half Day', 'Absent', 'Leave', 'Holiday', 'Weekly Off', 'Late', 'Early Logout', 'Incomplete'].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                ) : (
                  <input className="e-fld" value={f.value} placeholder={placeholder} onChange={(ev) => setF({ ...f, value: ev.target.value })} />
                )}
              </label>
            </div>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span className="e-lbl">Reason (required)</span>
              <textarea className="e-fld" value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} placeholder="e.g. Was on a client call on mobile after 18:30. Call log shared by TL." />
            </label>
            <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="e-btn" onClick={() => setF({ field: 'logout', value: '', reason: '' })}>
                Cancel
              </button>
              <button type="button" className="e-btn p" disabled={busy || !s || !f.value || !f.reason.trim()} onClick={save}>
                Save correction
              </button>
            </div>
          </section>
          <section className="e-card pad">
            <h2 className="e-ct" style={{ marginBottom: 10 }}>
              Change history
            </h2>
            {d.history.length === 0 && <p className="e-cs">No manual changes on this day.</p>}
            <div style={{ fontSize: 12, color: 'var(--e-ink2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {d.history.map((h) => (
                <div key={h._id}>
                  <b>{h.actorName}</b> {h.action.toLowerCase()}: {h.oldValue} → {h.newValue}
                  <div style={{ color: 'var(--e-mut)' }}>
                    {dateLabel(h.at, { year: false })}, {clock(h.at)}
                    {h.reason ? ` · “${h.reason}”` : ''}
                  </div>
                </div>
              ))}
              {s && (
                <div>
                  <b>System</b> set status {d.status} ({hm(t.work)} {t.work >= d.required ? '≥' : '<'} {hm(d.required)})
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
