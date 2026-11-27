import React, { useEffect, useState } from 'react';
import api from '../api';
import { Av, B, Empty, ErrorState, Search, Select, Seg, Skeleton, Trunc, dateLabel, clock, useErpLive, useLoad, useToast } from '../ui';
import { ExportMenu, deptOptions, useDecide, useLite } from './shared';
import { MarkLeaveModal } from './Attendance';

// A5 · Leave requests + approve / reject
export default function Leaves({ onChanged }) {
  const lite = useLite();
  const toast = useToast();
  const [status, setStatus] = useState('Pending');
  const [q, setQ] = useState('');
  const [type, setType] = useState('All');
  const [dept, setDept] = useState('All');
  const [range, setRange] = useState('All');
  const [selId, setSelId] = useState(null);
  const [mark, setMark] = useState(false);
  const rng = (() => {
    const t = new Date();
    if (range === 'This month') return { from: new Date(t.getFullYear(), t.getMonth(), 1).toLocaleDateString('en-CA'), to: new Date(t.getFullYear(), t.getMonth() + 1, 0).toLocaleDateString('en-CA') };
    if (range === 'Next 60 days') return { from: t.toLocaleDateString('en-CA'), to: new Date(t.getTime() + 60 * 864e5).toLocaleDateString('en-CA') };
    return {};
  })();
  const { data, loading, error, reload } = useLoad(() => api.get('admin/leaves', { status, q, type, dept, ...rng }), [status, q, type, dept, range]);
  useErpLive(() => reload(true));
  const after = () => {
    reload(true);
    onChanged && onChanged();
  };
  const { approve, reject, dialog } = useDecide(after);
  const list = (data && data.list) || [];
  useEffect(() => {
    if (list.length && !list.find((l) => l._id === selId)) setSelId(list[0]._id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const sel = list.find((l) => l._id === selId);
  const c = (data && data.counts) || {};
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Leave requests</h1>
          <p className="e-sub">An approval or rejection emails the employee and shows in their portal at once.</p>
        </div>
        <div className="e-row">
          <button type="button" className="e-btn" onClick={() => setMark(true)}>
            + Mark leave for employee
          </button>
          <ExportMenu kind="leaves" />
        </div>
      </div>
      <div className="e-row" style={{ gap: 10 }}>
        <Seg value={status} onChange={setStatus} options={[['Pending', `Pending ${c.Pending ?? ''}`], ['Approved', `Approved ${c.Approved ?? ''}`], ['Rejected', `Rejected ${c.Rejected ?? ''}`], ['All', `All ${c.All ?? ''}`]]} />
        <Search value={q} onChange={setQ} placeholder="Search employee or reason" style={{ flex: '1 1 200px' }} />
        <Select label="Type" value={type} onChange={setType} options={['All', ...lite.leaveTypes]} />
        <Select label="Dates" value={range} onChange={setRange} options={['All', 'This month', 'Next 60 days']} />
        <Select label="Department" value={dept} onChange={setDept} options={deptOptions(lite)} />
        <button
          type="button"
          className="e-btn ghost"
          onClick={() => {
            setQ('');
            setType('All');
            setDept('All');
            setRange('All');
          }}
        >
          Reset
        </button>
      </div>
      {loading && !data ? (
        <Skeleton rows={5} />
      ) : error && !data ? (
        <ErrorState onRetry={() => reload()} />
      ) : (
        <div className="e-split">
          <section className="e-card main">
            {list.length === 0 && <Empty title={status === 'Pending' ? 'No pending leave requests' : 'No leaves match'} text={status === 'Pending' ? 'All requests have been answered. New ones show here and in the bell as soon as they are sent.' : 'Change or reset the filters.'} />}
            {list.map((l) => (
              <div key={l._id} className={`e-li${l._id === selId ? ' sel' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setSelId(l._id)}>
                <Av name={l.employee} size={34} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="e-row" style={{ gap: 8 }}>
                    <Trunc text={l.employee} sub={l.emp && [l.emp.department, l.emp.designation].filter(Boolean).join(' · ')} style={{ fontSize: 14, fontWeight: 600, maxWidth: 260 }} />
                    <B>{l.status}</B>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--e-ink2)', marginTop: 4 }}>
                    {l.leaveType} Leave · {l.label} · <b>{l.days} day{l.days === 1 ? '' : 's'}</b>
                  </div>
                  <div title={l.reason} style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {l.reason || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--e-mut)', marginTop: 6 }}>
                    Sent {dateLabel(l.appliedOn || l.created, { year: false })}, {clock(l.appliedOn || l.created)}
                    {l.decisionBy ? ` · ${l.status} by ${l.decisionBy}` : ''}
                  </div>
                </div>
                <div className="e-row" style={{ gap: 6, justifyContent: 'flex-end' }} onClick={(ev) => ev.stopPropagation()}>
                  {l.status === 'Pending' && (
                    <>
                      <button type="button" className="e-btn sm d" onClick={() => reject(l)}>
                        Reject
                      </button>
                      <button type="button" className="e-btn sm ok" onClick={() => approve(l)}>
                        Approve
                      </button>
                    </>
                  )}
                  <button type="button" className="e-btn sm" onClick={() => setSelId(l._id)}>
                    Details
                  </button>
                </div>
              </div>
            ))}
          </section>
          {sel && (
            <aside className="side">
              <section className="e-card pad">
                <div className="e-row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                  <Av name={sel.employee} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Trunc text={sel.employee} style={{ fontSize: 15, fontWeight: 600 }} />
                    <p className="e-cs">{sel.emp && [sel.emp.employeeCode, sel.emp.department, sel.emp.designation].filter(Boolean).join(' · ')}</p>
                  </div>
                  <B>{sel.status}</B>
                </div>
                <div className="e-kv2" style={{ marginTop: 18 }}>
                  <div>
                    Leave<b>{sel.leaveType} Leave</b>
                  </div>
                  <div>
                    Duration<b>
                      {sel.days} day{sel.days === 1 ? '' : 's'}
                      {sel.durationType === 'half' ? ` (${sel.halfPart} half)` : sel.days === 1 ? ' (full)' : ''}
                    </b>
                  </div>
                  <div>
                    From<b>{dateLabel(sel.fromDate, { weekday: true })}</b>
                  </div>
                  <div>
                    To<b>{dateLabel(sel.toDate, { weekday: true })}</b>
                  </div>
                  {sel.balance && (
                    <>
                      <div>
                        Balance now<b>
                          {sel.balance.now} of {sel.balance.total} {sel.leaveType}
                        </b>
                      </div>
                      <div>
                        After approval<b>
                          {Math.max(0, sel.status === 'Pending' ? sel.balance.after : sel.balance.now - sel.days)} {sel.leaveType} left
                        </b>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ marginTop: 16, fontSize: 12, color: 'var(--e-mut)' }}>Reason</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{sel.reason || '—'}</div>
                {sel.decisionNote && (
                  <>
                    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--e-mut)' }}>Decision note</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{sel.decisionNote}</div>
                  </>
                )}
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--e-mut)' }}>Attachment</div>
                {sel.attachmentId ? (
                  <button type="button" className="e-btn" style={{ marginTop: 6, width: '100%', justifyContent: 'flex-start' }} onClick={async () => !(await api.openFile(`leaves/${sel._id}/attachment`)) && toast.err('Could not open the file')}>
                    {sel.attachmentName || 'Open attachment'}
                  </button>
                ) : (
                  <div style={{ marginTop: 6, padding: '8px 10px', border: '1px solid var(--e-line)', borderRadius: 8, fontSize: 13, color: 'var(--e-mut)' }}>None added (optional)</div>
                )}
                {sel.sameDay.length > 0 ? (
                  <div className="e-note warn" style={{ marginTop: 14 }}>
                    Same day{sel.days > 1 ? 's' : ''}: {sel.sameDay.map((x) => `${x.name}${x.department ? ` (${x.department})` : ''}${x.status === 'Pending' ? ' — pending' : ''}`).join(', ')} {sel.sameDay.length === 1 ? 'is' : 'are'} also off.
                  </div>
                ) : (
                  <div className="e-note info" style={{ marginTop: 14 }}>
                    Nobody else is off on these dates.
                  </div>
                )}
                <div className="e-note info" style={{ marginTop: 12 }}>
                  {sel.source === 'erp-portal' ? `Email sent on request to HR (${(data.recipients || []).join(', ') || 'LEAVE_ADMIN_EMAIL / LEAVE_NOTIFICATION_EMAIL not set'})` : sel.source === 'erp-admin' ? 'Marked by an admin' : 'Applied from the CRM header'} · {dateLabel(sel.appliedOn || sel.created, { year: false })}, {clock(sel.appliedOn || sel.created)}
                </div>
                {sel.status === 'Pending' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginTop: 18 }}>
                    <button type="button" className="e-btn d" onClick={() => reject(sel)}>
                      Reject
                    </button>
                    <button type="button" className="e-btn ok" onClick={() => approve(sel)}>
                      Approve
                    </button>
                  </div>
                )}
              </section>
            </aside>
          )}
        </div>
      )}
      {dialog}
      <MarkLeaveModal open={mark} onClose={() => setMark(false)} onDone={after} />
    </div>
  );
}
