import React, { useState } from 'react';
import api from '../api';
import { Card, Drawer, ErrorState, Ic, Select, Skeleton, Trunc, clock, dateLabel, useLoad } from '../ui';
import { ExportMenu, empOptions, useLite } from './shared';

// A9 · Audit log. Since 2026-11-28 it is a drawer opened from Settings ›
// "Audit log" (no sub-tab, no ERP bell). HRMS notifications go to the CRM
// header bell only (backend notify(), module HRMS).
export default function AuditPanel({ open, onClose }) {
  const lite = useLite();
  const [actor, setActor] = useState('All');
  const [action, setAction] = useState('All');
  const [employee, setEmployee] = useState('All');
  const [days, setDays] = useState('30');
  const a = useLoad(() => api.get('admin/audit', { actor, action, employee, days }), [actor, action, employee, days]);
  return (
    <Drawer open={open} onClose={onClose} wide label="Audit log">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button type="button" className="e-btn sm" aria-label="Close" onClick={onClose}>
          <Ic n="x" s={14} />
        </button>
      </div>
      {(
      <Card title="Audit log" sub="Read-only. Rows can't be edited or deleted, even by the owner." right={<ExportMenu kind="audit" label="Export CSV" />} flush>
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
      )}
    </Drawer>
  );
}
