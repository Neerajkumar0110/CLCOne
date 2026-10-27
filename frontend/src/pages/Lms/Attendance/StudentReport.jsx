import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Tooltip } from 'antd';
import {
  CloseOutlined, DownloadOutlined, MailOutlined, PhoneOutlined, BookOutlined, TeamOutlined, IdcardOutlined,
  CalendarOutlined, ClockCircleOutlined, FireOutlined, WarningOutlined, CheckCircleOutlined, CloseCircleOutlined,
  MinusCircleOutlined, SafetyOutlined, FieldTimeOutlined, EyeOutlined, SwapOutlined, DownOutlined, RightOutlined,
} from '@ant-design/icons';
import { downloadCsv, rowsToCsv } from '@/components/dashboard/csvExport';
import lmsApi from '../api';
import './StudentReport.css';

// Row click on the Attendance dashboard → this candidate's whole attendance
// story: roster status + engagement, totals, streaks, class-by-class strip,
// month by month and every class with its join/leave intervals.

const TZ = 'Asia/Kolkata';
const ST = {
  PRESENT: ['Present', '#16A34A'],
  LATE: ['Late', '#CA8A04'],
  PARTIAL: ['Partial', '#EA580C'],
  ABSENT: ['Absent', '#DC2626'],
  EXCUSED: ['Excused', '#2563EB'],
  LIVE: ['Live now', '#7C3AED'],
  UPCOMING: ['Upcoming', '#64748B'],
};
const ENGAGE = { active: '#16A34A', risk: '#D97706', inactive: '#DC2626', dropped: '#DC2626', deactivated: '#DC2626', roster: '#64748B', new: '#64748B' };
const ROSTER = { Active: '#16A34A', 'On Hold': '#D97706', Completed: '#2563EB', Dropped: '#DC2626', Deferred: '#7C3AED' };

const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dayShort = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric', month: 'short' }) : '—');
const weekday = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short' }) : '');
const time = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '—');
const hm = (min) => {
  const m = Math.round(min || 0);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const ago = (d) => {
  if (!d) return 'never';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  const days = Math.round(m / 1440);
  return days === 1 ? 'yesterday' : `${days} days ago`;
};
const monthLabel = (k) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

function Pill({ color, children, title }) {
  return <span className="sr-pill" style={{ '--c': color }} title={title}>{children}</span>;
}

function Ring({ pct }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const tone = pct >= 75 ? '#16A34A' : pct >= 50 ? '#D97706' : '#DC2626';
  return (
    <svg className="sr-ring" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r={r} className="sr-ring-bg" />
      <circle cx="38" cy="38" r={r} stroke={tone} strokeDasharray={`${(c * Math.min(100, pct)) / 100} ${c}`} transform="rotate(-90 38 38)" className="sr-ring-fg" />
      <text x="38" y="43" textAnchor="middle">{pct}%</text>
    </svg>
  );
}

export default function StudentReport({ role, target, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState({});
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!target) return;
    setData(null);
    setError('');
    setOpen({});
    setFilter('all');
    lmsApi
      .attendanceStudentReport(role, { crmUser: target.crmUser, email: target.email, name: target.studentName })
      .then((r) => (r?.success ? setData(r.result) : setError(r?.message || 'Could not load the report.')))
      .catch(() => setError('Could not load the report.'));
  }, [role, target]);

  const classes = useMemo(() => (data ? [...data.classes].reverse() : []), [data]);
  if (!target) return null;
  const p = data?.profile || {};
  const s = data?.summary || {};
  const e = data?.engagement;
  const shown = classes.filter((c) => filter === 'all' || (filter === 'PRESENT' ? c.status === 'PRESENT' || c.status === 'LATE' : c.status === filter));
  const counts = {
    all: classes.length,
    PRESENT: (s.present || 0) + (s.late || 0),
    PARTIAL: s.partial || 0,
    ABSENT: s.absent || 0,
    EXCUSED: s.excused || 0,
  };

  const exportCsv = () => {
    const cols = [
      ['date', 'Date'], ['className', 'Class'], ['batch', 'Batch'], ['course', 'Internship'], ['teacher', 'Project Manager'], ['scheduledDurationMin', 'Scheduled (min)'],
      ['join', 'Join'], ['leave', 'Leave'], ['totalDurationMin', 'Attended (min)'], ['attendancePct', 'Attendance %'], ['lateMin', 'Late (min)'], ['joins', 'Joins'], ['status', 'Status'], ['note', 'Note'],
    ].map(([key, label]) => ({ key, label }));
    const out = data.classes.map((c) => ({
      ...c,
      date: day(c.date),
      join: c.joinTime ? time(c.joinTime) : '',
      leave: c.leaveTime ? time(c.leaveTime) : '',
      note: c.corrected ? `Corrected by ${c.correctedByName}: ${c.correctedReason}` : c.excusedReason || '',
    }));
    downloadCsv(`attendance-${(p.name || 'candidate').replace(/\s+/g, '-')}.csv`, rowsToCsv(out, cols));
  };

  const alerts = [];
  if (s.currentAbsent >= 3) alerts.push(['bad', `Absent the last ${s.currentAbsent} classes in a row — last attended ${s.lastPresent ? day(s.lastPresent) : 'never'}.`]);
  if (p.rosterStatus === 'Dropped') alerts.push(['bad', 'Marked Dropped on the roster.']);
  if (p.accessDisabled) alerts.push(['bad', 'LMS access is switched off for this candidate.']);
  if (s.unmarked) alerts.push(['info', `${s.unmarked} batch class${s.unmarked === 1 ? '' : 'es'} (${dayShort(s.unmarkedFrom)} – ${dayShort(s.unmarkedTo)}) have no attendance record for this candidate — not counted as absent.`]);

  return (
    <Modal open onCancel={onClose} footer={null} width={1080} closable={false} destroyOnClose className="sr-modal" styles={{ content: { padding: 0, overflow: 'hidden', borderRadius: 20 } }}>
      {/* header */}
      <div className="sr-head">
        <span className="sr-avatar">{initials(p.name || target.studentName)}</span>
        <div className="sr-head-txt">
          <div className="sr-kicker">Attendance report</div>
          <div className="sr-name">{p.name || target.studentName}</div>
          <div className="sr-meta">
            {(p.email || target.email) && <span><MailOutlined /> {p.email || target.email}</span>}
            {p.phone && <span><PhoneOutlined /> {p.phone}</span>}
            {p.enrollmentId && <span><IdcardOutlined /> {p.enrollmentId}</span>}
          </div>
          <div className="sr-meta">
            {(p.batch || target.batch) && <span><TeamOutlined /> {p.batch || target.batch}</span>}
            {(p.course || target.course) && <span><BookOutlined /> {p.course || target.course}</span>}
          </div>
        </div>
        <div className="sr-head-side">
          {e && (
            <div className="sr-engage" style={{ '--c': ENGAGE[e.key] || '#64748B' }}>
              <b>{e.label}</b>
              <span>{e.note}</span>
            </div>
          )}
          {p.rosterStatus && <Pill color={ROSTER[p.rosterStatus] || '#64748B'} title="Roster status (Candidates tab)">Roster: {p.rosterStatus}</Pill>}
          <span className="sr-seen"><EyeOutlined /> {p.hasLogin ? `Last seen in LMS ${ago(p.lastSeenAt)}` : 'No LMS login linked'}</span>
        </div>
        <button type="button" className="sr-close" onClick={onClose} aria-label="Close"><CloseOutlined /></button>
      </div>

      <div className="sr-body">
        {error && <div className="sr-alert bad"><WarningOutlined /> {error}</div>}
        {!data && !error && (
          <div className="sr-skel">
            <i /><i /><i />
          </div>
        )}

        {data && (
          <>
            {alerts.map(([tone, txt], i) => (
              <div key={i} className={`sr-alert ${tone}`}>{tone === 'bad' ? <WarningOutlined /> : <CalendarOutlined />} {txt}</div>
            ))}

            {/* KPIs */}
            <div className="sr-top">
              <div className="sr-ringcard">
                <Ring pct={s.presentRate || 0} />
                <div>
                  <b>{s.attendedClasses || 0} of {(s.classes || 0) - (s.excused || 0)}</b>
                  <span>classes attended</span>
                  <small>avg {s.avgAttendancePct || 0}% of each class</small>
                </div>
              </div>
              <div className="sr-kpis">
                {[
                  ['Classes', s.classes || 0, <CalendarOutlined key="i" />, '#4F46E5', s.firstClass ? `since ${dayShort(s.firstClass)}` : 'none yet'],
                  ['Present', s.present || 0, <CheckCircleOutlined key="i" />, '#16A34A', s.late ? `+ ${s.late} marked late` : s.lateMinTotal ? `joined ${hm(s.lateMinTotal)} late in all` : 'always on time'],
                  ['Partial', s.partial || 0, <MinusCircleOutlined key="i" />, '#EA580C', 'left early / joined late'],
                  ['Absent', s.absent || 0, <CloseCircleOutlined key="i" />, '#DC2626', s.absent ? `longest run ${s.longestAbsent}` : 'never missed'],
                  ['Excused', s.excused || 0, <SafetyOutlined key="i" />, '#2563EB', 'not counted in %'],
                  ['Time in class', hm(s.totalMin), <FieldTimeOutlined key="i" />, '#0E7490', `of ${hm(s.scheduledMin)}`],
                  ['Current streak', s.currentAbsent ? `${s.currentAbsent} absent` : `${s.currentPresent || 0} present`, <FireOutlined key="i" />, s.currentAbsent ? '#DC2626' : '#16A34A', `best ${s.longestPresent || 0} in a row`],
                  ['Last attended', s.lastPresent ? dayShort(s.lastPresent) : 'never', <ClockCircleOutlined key="i" />, '#7C3AED', s.lastPresent ? ago(s.lastPresent) : 'no class attended'],
                ].map(([k, v, icon, c, sub]) => (
                  <div key={k} className="sr-kpi" style={{ '--c': c }}>
                    <span className="sr-kpi-ico">{icon}</span>
                    <div>
                      <b>{v}</b>
                      <span>{k}</span>
                      <small>{sub}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* class-by-class strip */}
            <section className="sr-panel">
              <header>
                <h4>Class by class</h4>
                <div className="sr-legend">
                  {['PRESENT', 'LATE', 'PARTIAL', 'ABSENT', 'EXCUSED', 'LIVE'].map((k) => <span key={k}><i style={{ background: ST[k][1] }} />{ST[k][0]}</span>)}
                </div>
              </header>
              {data.classes.length ? (
                <div className="sr-dots">
                  {data.classes.map((c, i) => (
                    <Tooltip
                      key={c.sessionId}
                      overlayClassName="sr-tip"
                      mouseEnterDelay={0.05}
                      title={
                        <div style={{ '--c': (ST[c.status] || [0, '#94A3B8'])[1] }}>
                          <div className="sr-tip-date">{weekday(c.date)}, {day(c.date)} · {time(c.date)}</div>
                          <div className="sr-tip-title">{c.className}</div>
                          <div className="sr-tip-row">
                            <span className="sr-tip-status"><i />{(ST[c.status] || [c.status])[0]}</span>
                            <span>{c.totalDurationMin} / {c.scheduledDurationMin} min · {c.attendancePct}%</span>
                          </div>
                          <div className="sr-tip-bar"><i style={{ width: `${Math.min(100, c.attendancePct)}%` }} /></div>
                          {c.joinTime && <div className="sr-tip-time">Joined {time(c.joinTime)}{c.leaveTime ? ` · left ${time(c.leaveTime)}` : ''}{c.lateMin > 5 ? ` · ${c.lateMin}m late` : ''}</div>}
                        </div>
                      }
                    >
                      <span className="sr-dot" style={{ '--c': (ST[c.status] || [0, '#94A3B8'])[1], animationDelay: `${Math.min(i, 60) * 12}ms` }}>
                        <b>{new Date(c.date).toLocaleDateString('en-IN', { timeZone: TZ, day: 'numeric' })}</b>
                        <small>{new Date(c.date).toLocaleDateString('en-IN', { timeZone: TZ, month: 'short' })}</small>
                      </span>
                    </Tooltip>
                  ))}
                </div>
              ) : (
                <div className="sr-empty">No class attendance recorded yet.</div>
              )}
            </section>

            <div className="sr-grid">
              {/* month by month */}
              <section className="sr-panel">
                <header><h4>Month by month</h4></header>
                {data.months.length ? (
                  <div className="sr-months">
                    {data.months.map((m) => (
                      <div key={m.month} className="sr-month">
                        <div className="sr-month-top">
                          <b>{monthLabel(m.month)}</b>
                          <span>{m.present + m.late}/{m.classes} attended · {hm(m.minutes)} · avg {m.avgPct}%</span>
                        </div>
                        <div className="sr-stack">
                          {[['present', 'PRESENT'], ['late', 'LATE'], ['partial', 'PARTIAL'], ['absent', 'ABSENT']].map(([k, st]) =>
                            m[k] ? <i key={k} style={{ width: `${(m[k] / m.classes) * 100}%`, background: ST[st][1] }} title={`${ST[st][0]}: ${m[k]}`} /> : null
                          )}
                        </div>
                        <div className="sr-month-n">
                          <span style={{ color: ST.PRESENT[1] }}>{m.present} present</span>
                          {m.late > 0 && <span style={{ color: ST.LATE[1] }}>{m.late} late</span>}
                          {m.partial > 0 && <span style={{ color: ST.PARTIAL[1] }}>{m.partial} partial</span>}
                          <span style={{ color: ST.ABSENT[1] }}>{m.absent} absent</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sr-empty">Nothing yet.</div>
                )}
              </section>

              {/* journey */}
              <section className="sr-panel">
                <header><h4>Journey</h4></header>
                <ul className="sr-journey">
                  {p.enrolledOn && <li><i style={{ '--c': '#4F46E5' }} /><b>Enrolled</b><span>{day(p.enrolledOn)}</span></li>}
                  {(p.batchHistory || []).map((h, i) => (
                    <li key={i}><i style={{ '--c': '#0E7490' }} /><b><SwapOutlined /> Batch {h.from ? `${h.from} → ${h.to}` : h.to}</b><span>{day(h.at)}{h.by ? ` · by ${h.by}` : ''}</span></li>
                  ))}
                  {s.firstClass && <li><i style={{ '--c': '#16A34A' }} /><b>First class on record</b><span>{day(s.firstClass)}</span></li>}
                  {s.lastPresent && <li><i style={{ '--c': '#16A34A' }} /><b>Last attended</b><span>{day(s.lastPresent)}</span></li>}
                  {s.lastClass && <li><i style={{ '--c': '#64748B' }} /><b>Last finished class</b><span>{day(s.lastClass)}</span></li>}
                  {data.nextClass && (
                    <li><i style={{ '--c': '#7C3AED' }} /><b>{data.nextClass.status === 'live' ? 'Live now' : 'Next class'}</b><span>{data.nextClass.title} · {day(data.nextClass.at)} {time(data.nextClass.at)}</span></li>
                  )}
                  {p.progress != null && <li><i style={{ '--c': '#CA8A04' }} /><b>Course progress</b><span>{p.progress}%{p.avgScore ? ` · avg score ${p.avgScore}` : ''}</span></li>}
                </ul>
              </section>
            </div>

            {/* every class */}
            <section className="sr-panel">
              <header>
                <h4>Every class</h4>
                <button type="button" className="sr-btn" onClick={exportCsv}><DownloadOutlined /> CSV</button>
              </header>
              <div className="sr-chips">
                {[['all', 'All'], ['PRESENT', 'Present'], ['PARTIAL', 'Partial'], ['ABSENT', 'Absent'], ['EXCUSED', 'Excused']].map(([k, l]) => (
                  <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} <em>{counts[k]}</em></button>
                ))}
              </div>
              <div className="sr-table-wrap">
                <table className="sr-table">
                  <thead>
                    <tr><th /><th>Date</th><th>Class</th><th>Join</th><th>Leave</th><th>Attended</th><th>%</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {!shown.length && <tr><td colSpan={8}><div className="sr-empty">Nothing for this filter.</div></td></tr>}
                    {shown.map((c) => {
                      const st = ST[c.status] || [c.status, '#64748B'];
                      const isOpen = !!open[c.sessionId];
                      return (
                        <React.Fragment key={c.sessionId}>
                          <tr className={c.intervals.length ? 'sr-click' : ''} onClick={() => c.intervals.length && setOpen((o) => ({ ...o, [c.sessionId]: !o[c.sessionId] }))}>
                            <td className="sr-caret">{c.intervals.length ? (isOpen ? <DownOutlined /> : <RightOutlined />) : null}</td>
                            <td className="sr-nowrap"><b>{dayShort(c.date)}</b> <span className="sr-muted">{weekday(c.date)}</span></td>
                            <td>
                              <div className="sr-class">{c.className}</div>
                              <div className="sr-muted">{c.batch}{c.teacher ? ` · ${c.teacher}` : ''}</div>
                            </td>
                            <td className="sr-nowrap">{time(c.joinTime)}{c.lateMin > 5 && <div className="sr-warn">{c.lateMin}m late</div>}</td>
                            <td className="sr-nowrap">{time(c.leaveTime)}</td>
                            <td className="sr-nowrap">{c.totalDurationMin} <span className="sr-muted">/ {c.scheduledDurationMin} min</span></td>
                            <td style={{ minWidth: 110 }}>
                              <div className="sr-bar"><i style={{ width: `${Math.min(100, c.attendancePct)}%`, background: st[1] }} /></div>
                              <span className="sr-muted">{c.attendancePct}%</span>
                            </td>
                            <td>
                              <Pill color={st[1]}>{st[0]}</Pill>
                              {c.corrected && <div className="sr-muted" title={c.correctedReason}>corrected by {c.correctedByName}</div>}
                              {c.excusedReason && <div className="sr-muted">{c.excusedReason}</div>}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="sr-sub">
                              <td />
                              <td colSpan={7}>
                                <div className="sr-intervals">
                                  <span className="sr-muted">{c.joins} join{c.joins === 1 ? '' : 's'} · {c.leaves} leave{c.leaves === 1 ? '' : 's'}</span>
                                  {c.intervals.map((x, i) => (
                                    <span key={i} className="sr-interval">{time(x.joinedAt)} → {x.leftAt ? time(x.leftAt) : 'still in'} <b>{x.durationMin}m</b></span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
