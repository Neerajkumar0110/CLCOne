import React, { useState } from 'react';
import api from '../api';
import { Card, ErrorState, Select, Skeleton, Trunc, clock, dateLabel, useErpLive, useLoad, useToast } from '../ui';
import { ExportMenu, empOptions, useLite } from './shared';

// A9 · Notifications + Audit log
const KIND = (type = '') => {
  if (/approved|counted/.test(type)) return ['✓', 'rgba(22,163,74,.13)', '#15803D'];
  if (/rejected/.test(type)) return ['✕', 'rgba(220,38,38,.11)', '#B91C1C'];
  if (/correction/.test(type)) return ['✎', 'rgba(124,58,237,.12)', '#6D28D9'];
  if (/review|short|idle/.test(type)) return ['!', 'rgba(217,119,6,.14)', '#B45309'];
  if (/leave/.test(type)) return ['L', 'rgba(37,99,235,.12)', '#1D4ED8'];
  return ['i', 'var(--e-line2)', '#475569'];
};

export default function Audit({ focus, onChanged }) {
  const lite = useLite();
  const toast = useToast();
  const [actor, setActor] = useState('All');
  const [action, setAction] = useState('All');
  const [employee, setEmployee] = useState('All');
  const [days, setDays] = useState('30');
  const n = useLoad(() => api.get('admin/notifications'), [], { poll: 60000 });
  const a = useLoad(() => api.get('admin/audit', { actor, action, employee, days }), [actor, action, employee, days]);
  useErpLive(() => n.reload(true));
  const readAll = async () => {
    const r = await api.post('admin/notifications/read-all');
    toast.res(r, 'All marked as read');
    n.reload(true);
    onChanged && onChanged();
  };
  const notes = n.data ? n.data.list : [];
  return (
    <div className="e-split" style={{ alignItems: 'flex-start' }}>
      <Card
        className="side"
        style={{ order: focus === 'audit' ? 2 : 0 }}
        title={
          <>
            Notifications{' '}
            {n.data && n.data.unread > 0 && (
              <span style={{ fontSize: 11, background: '#DC2626', color: '#fff', borderRadius: 999, padding: '1px 7px', marginLeft: 4 }}>
                {n.data.unread} new
              </span>
            )}
          </>
        }
        sub="Also shown in the bell in the header"
        right={
          <button type="button" className="e-btn sm" onClick={readAll}>
            Mark all read
          </button>
        }
        flush
      >
        {n.loading && !n.data ? <Skeleton rows={4} /> : n.error && !n.data ? <ErrorState onRetry={() => n.reload()} /> : null}
        {n.data && notes.length === 0 && <p className="e-cs" style={{ padding: 20 }}>No notifications yet. New leave requests, sessions to review and notes from employees show here.</p>}
        {notes.map((x) => {
          const [k, bg, c] = KIND(x.type);
          return (
            <div key={x._id} className="e-row" style={{ gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--e-line2)', flexWrap: 'nowrap', alignItems: 'flex-start', background: x.readAt ? undefined : 'rgba(79,70,229,.04)' }}>
              <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: bg, color: c }}>{k}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--e-ink)', fontWeight: x.readAt ? 400 : 600 }}>{x.title}</div>
                <Trunc text={x.body || ''} style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 2 }} />
                <div style={{ fontSize: 11, color: 'var(--e-mut)', marginTop: 4 }}>
                  {dateLabel(x.created, { year: false })}, {clock(x.created)}
                </div>
              </div>
              {!x.readAt && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--e-pri)', marginTop: 6, flex: 'none' }} />}
            </div>
          );
        })}
      </Card>
      <Card className="main" title="Audit log" sub="Read-only. Rows can't be edited or deleted, even by the owner." right={<ExportMenu kind="audit" label="Export CSV" />} flush>
        <div className="e-row" style={{ padding: '12px 20px', borderBottom: '1px solid var(--e-line2)' }}>
          <Select label="Admin" value={actor} onChange={setActor} options={['All', ...((a.data && a.data.actors) || [])]} />
          <Select label="Action" value={action} onChange={setAction} options={['All', ...((a.data && a.data.actions) || [])]} />
          <Select label="Employee" value={employee} onChange={setEmployee} options={empOptions(lite)} style={{ maxWidth: 220 }} />
          <Select label="Dates" value={days} onChange={setDays} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last year' }]} />
          <button
            type="button"
            className="e-btn sm ghost"
            onClick={() => {
              setActor('All');
              setAction('All');
              setEmployee('All');
              setDays('30');
            }}
          >
            Reset
          </button>
        </div>
        {a.loading && !a.data ? (
          <Skeleton rows={6} />
        ) : a.error && !a.data ? (
          <ErrorState onRetry={() => a.reload()} />
        ) : a.data.list.length === 0 ? (
          <p className="e-cs" style={{ padding: 20 }}>No changes in this period.</p>
        ) : (
          <div className="e-tw">
            <table className="e-tbl" style={{ minWidth: 880 }}>
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '19%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Action</th>
                  <th>Employee</th>
                  <th>When</th>
                  <th>Old value</th>
                  <th>New value</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {a.data.list.map((r) => (
                  <tr key={r._id}>
                    <td>
                      <Trunc text={r.actorName} />
                    </td>
                    <td>
                      <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 6, background: 'var(--e-line2)', color: 'var(--e-ink2)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.action}</span>
                    </td>
                    <td>
                      <Trunc text={r.employeeName || '—'} />
                    </td>
                    <td>
                      {dateLabel(r.at)}
                      <div style={{ fontSize: 11, color: 'var(--e-mut)' }}>{clock(r.at)}</div>
                    </td>
                    <td style={{ color: '#B91C1C', textDecoration: 'line-through' }}>
                      <Trunc text={r.oldValue || '—'} />
                    </td>
                    <td style={{ color: '#15803D', fontWeight: 600 }}>
                      <Trunc text={r.newValue || '—'} />
                    </td>
                    <td style={{ color: 'var(--e-mut)' }}>
                      <Trunc text={r.reason || '—'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
