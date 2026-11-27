import React, { useState } from 'react';
import api from '../api';
import { B, Bar, DateInp, Empty, ErrorState, Modal, ModalHead, Select, Seg, Skeleton, StatusBadges, clock, dateLabel, hm, todayKey, useLoad, usePager, useToast, workColor } from '../ui';

// E3 · My Attendance — daily / weekly / monthly / custom (own data only)
const SEG = { ACTIVE: '#16A34A', INACTIVE: '#F59E0B', LUNCH: '#8B5CF6', BREAK: '#8B5CF6', OFFLINE: '#CBD5E1' };

export default function MyAttendance() {
  const toast = useToast();
  const [period, setPeriod] = useState('monthly');
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [date, setDate] = useState(todayKey());
  const [from, setFrom] = useState(todayKey().slice(0, 8) + '01');
  const [to, setTo] = useState(todayKey());
  const [status, setStatus] = useState('All');
  const [open, setOpen] = useState(null);
  const [report, setReport] = useState(null);
  const [text, setText] = useState('');
  const { data, loading, error, reload } = useLoad(() => api.get('me/attendance', { period, month, date, from, to, status }), [period, month, date, from, to, status]);
  const rows = (data && data.rows) || [];
  const pg = usePager(rows, 12);
  const months = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    return { value: d.toLocaleDateString('en-CA').slice(0, 7), label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
  });
  const sm = data && data.summary;
  const sendReport = async () => {
    // a problem with a day goes to HR (bell) as a note on that day's attendance
    const r = await api.post('me/report', { dayKey: report, note: text });
    toast.res(r, 'Sent to HR — they will check the day');
    if (!r.success) return;
    setReport(null);
    setText('');
  };
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">My attendance</h1>
          <p className="e-sub">Only your own records. Something wrong? Use “Report a problem” on that day.</p>
        </div>
        <button type="button" className="e-btn" onClick={() => window.print()}>
          Download PDF
        </button>
      </div>
      <div className="e-row" style={{ gap: 10 }}>
        <Seg value={period} onChange={setPeriod} options={[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom']]} />
        {period === 'monthly' && <Select label="Month" value={month} onChange={setMonth} options={months} />}
        {(period === 'daily' || period === 'weekly') && <DateInp label={period === 'weekly' ? 'Week of' : 'Date'} value={date} onChange={(v) => setDate(v || todayKey())} />}
        {period === 'custom' && (
          <>
            <DateInp label="From" value={from} onChange={setFrom} />
            <DateInp label="To" value={to} onChange={setTo} />
          </>
        )}
        <Select label="Status" value={status} onChange={setStatus} options={['All', 'Present', 'Late', 'Short', 'Half Day', 'Leave', 'Absent', 'Holiday', 'Weekly Off', 'Needs review']} />
        <button
          type="button"
          className="e-btn ghost"
          onClick={() => {
            setPeriod('monthly');
            setMonth(todayKey().slice(0, 7));
            setStatus('All');
          }}
        >
          Reset
        </button>
      </div>
      {loading && !data ? (
        <Skeleton kpis={6} rows={8} />
      ) : error && !data ? (
        <ErrorState onRetry={() => reload()} />
      ) : (
        <>
          {sm && (
            <div className="e-kpis sm" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
              <div className="e-kpi">
                <div className="e-kl">Working days</div>
                <div className="e-kv">
                  {sm.workingDays} <span style={{ fontSize: 13, color: 'var(--e-mut)', fontWeight: 500 }}>so far</span>
                </div>
              </div>
              <div className="e-kpi">
                <div className="e-kl">Present</div>
                <div className="e-kv" style={{ color: '#15803D' }}>
                  {sm.present}
                </div>
              </div>
              <div className="e-kpi">
                <div className="e-kl">Late</div>
                <div className="e-kv" style={{ color: '#B45309' }}>
                  {sm.late}
                </div>
              </div>
              <div className="e-kpi">
                <div className="e-kl">Short / Half day</div>
                <div className="e-kv" style={{ color: '#B91C1C' }}>
                  {sm.short} / {sm.half}
                </div>
              </div>
              <div className="e-kpi">
                <div className="e-kl">Leave</div>
                <div className="e-kv" style={{ color: '#1D4ED8' }}>
                  {sm.leave}
                </div>
              </div>
              <div className="e-kpi">
                <div className="e-kl">Avg work / day</div>
                <div className="e-kv">{hm(sm.avgWork)}</div>
              </div>
            </div>
          )}
          <section className="e-card">
            {rows.length === 0 ? (
              <Empty title="No days to show" text="Pick another period or reset the filters." icon="cal" />
            ) : (
              <>
                <div className="e-tw e-hide-m">
                  <table className="e-tbl" style={{ minWidth: 860 }}>
                    <colgroup>
                      <col style={{ width: '17%' }} />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '15%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Login</th>
                        <th>Logout</th>
                        <th>Lunch</th>
                        <th>Active</th>
                        <th>Inactive</th>
                        <th>Total work</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pg.rows.map((r) => {
                        const t = r.totals;
                        const pct = t ? (t.work / data.required) * 100 : 0;
                        return (
                          <React.Fragment key={r.dayKey}>
                            <tr style={{ cursor: t ? 'pointer' : 'default', background: open === r.dayKey ? 'rgba(79,70,229,.04)' : undefined }} onClick={() => t && setOpen(open === r.dayKey ? null : r.dayKey)}>
                              <td>
                                <b style={{ color: 'var(--e-ink)', fontWeight: 600 }}>{dateLabel(r.dayKey, { year: false })}</b> <span style={{ color: 'var(--e-mut)' }}>{new Date(`${r.dayKey}T12:00:00+05:30`).toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                              </td>
                              <td>{clock(r.loginAt)}</td>
                              <td>{r.logoutAt ? clock(r.logoutAt) : '—'}</td>
                              <td>{t ? hm(t.lunch + t.break) : '—'}</td>
                              <td>{t ? hm(t.active) : '—'}</td>
                              <td>{t ? hm(t.inactive) : '—'}</td>
                              <td>
                                <div className="e-row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                                  <b style={{ color: 'var(--e-ink)', width: 62, flex: 'none' }}>{t ? hm(t.work) : '—'}</b>
                                  {t && <Bar pct={pct} color={workColor(pct)} style={{ flex: 1 }} />}
                                </div>
                              </td>
                              <td>
                                <StatusBadges status={r.status === 'Online' ? 'Online' : r.status} tags={r.tags} />
                              </td>
                            </tr>
                            {open === r.dayKey && (
                              <tr>
                                <td colSpan={8} style={{ background: 'rgba(79,70,229,.03)', padding: '14px 18px', whiteSpace: 'normal' }}>
                                  <div className="e-row" style={{ gap: 16 }}>
                                    <b style={{ fontSize: 13 }}>{dateLabel(r.dayKey, { weekday: true, year: false })} · timeline</b>
                                    <div className="e-daybar" style={{ flex: 1, minWidth: 280, height: 16, borderRadius: 5 }}>
                                      {r.periods.map((p, i) => {
                                        const b = new Date(`${r.dayKey}T09:00:00+05:30`).getTime();
                                        const sp = 10 * 3600e3;
                                        const l = Math.max(0, ((new Date(p.startAt) - b) / sp) * 100);
                                        const w = Math.max(0.3, ((new Date(p.endAt || Date.now()) - new Date(p.startAt)) / sp) * 100);
                                        return <i key={i} title={`${p.type} ${clock(p.startAt)}–${p.endAt ? clock(p.endAt) : 'now'}`} style={{ left: `${l}%`, width: `${w}%`, background: SEG[p.type] }} />;
                                      })}
                                    </div>
                                    <button type="button" className="e-btn ghost sm" onClick={() => setReport(r.dayKey)}>
                                      Report a problem
                                    </button>
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
                <div className="e-mcards">
                  {pg.rows.map((r) => (
                    <div key={r.dayKey} className="e-mcard">
                      <div className="e-row" style={{ flexWrap: 'nowrap' }}>
                        <b style={{ flex: 1, fontSize: 14 }}>{dateLabel(r.dayKey, { weekday: true, year: false })}</b>
                        <B>{r.status}</B>
                      </div>
                      {r.totals && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 10, fontSize: 11, color: 'var(--e-mut)' }}>
                          <div>
                            Login<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)' }}>{clock(r.loginAt)}</b>
                          </div>
                          <div>
                            Logout<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)' }}>{r.logoutAt ? clock(r.logoutAt) : '—'}</b>
                          </div>
                          <div>
                            Work<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)' }}>{hm(r.totals.work)}</b>
                          </div>
                          <div>
                            Lunch<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)' }}>{hm(r.totals.lunch)}</b>
                          </div>
                          <div>
                            Inactive<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)' }}>{hm(r.totals.inactive)}</b>
                          </div>
                          <div>
                            Short<b style={{ display: 'block', fontSize: 14, color: 'var(--e-ink)' }}>{hm(Math.max(0, data.required - r.totals.work))}</b>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="e-foot">
                  <span>
                    Total work = active time only (lunch, breaks and inactive time left out) · Showing {pg.from}–{pg.to} of {rows.length} days
                  </span>
                  <pg.Pager />
                </div>
              </>
            )}
          </section>
        </>
      )}
      <Modal open={!!report} onClose={() => setReport(null)} label="Report a problem">
        <ModalHead title="Report a problem with this day" sub={report ? dateLabel(report, { weekday: true }) : ''} onClose={() => setReport(null)} />
        <textarea className="e-fld" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. I worked till 19:00 on a client call but logout shows 18:30" autoFocus />
        <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="e-btn" onClick={() => setReport(null)}>
            Cancel
          </button>
          <button type="button" className="e-btn p" disabled={!text.trim()} onClick={sendReport}>
            Send to HR
          </button>
        </div>
      </Modal>
    </div>
  );
}
