import React, { useEffect, useState } from 'react';
import api from './api';
import Learner360Report from './Learner360Report';
import { Chip, Btn, Av, Card, Table, Screen, Loading, ErrorBox, useData } from './ui';

// Learner 360° reports for Support (read-only) and Admin (Figma 1B
// "Role-based visibility": Support — all · read-only). Pick a batch, open a
// learner's full 1A report.
export default function Learner360Lookup() {
  const [batch, setBatch] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const { data: d, error, loading } = useData(() => api.leaderboard(batch || undefined), [batch]);
  useEffect(() => {
    if (d && !batch && d.batches.length) setBatch(d.batches[0]);
  }, [d, batch]);
  if (open)
    return (
      <div>
        <div className="g-root" style={{ minHeight: 0 }}>
          <div style={{ padding: '12px 28px 0' }}>
            <Btn k="g" sm onClick={() => setOpen(null)}>
              Back to the list
            </Btn>
          </div>
        </div>
        <Learner360Report learnerId={open} crumbBase="LMS / Learner 360°" />
      </div>
    );
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const rows = (d.rows || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Screen
      crumb="LMS / Learner 360°"
      title="Learner 360° reports"
      actions={
        <>
          <input className="g-input" style={{ width: 220 }} placeholder="Search a learner…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <div className="g-input" style={{ width: 'auto', padding: '7px 10px' }}>
            <select value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch" style={{ fontWeight: 600 }}>
              {d.batches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </>
      }
    >
      <Card title={`${batch || 'Batch'} · ${rows.length} learners`} i="users" sub="Click a learner to open the full 360° report">
        <Table
          cols={[
            ['#', 40],
            ['Learner', 'f'],
            ['Att.', 50],
            ['Asmt', 50],
            ['Code', 50],
            ['Proj', 50],
            ['Score', 56],
            ['Level', 130],
          ]}
          onRow={(i) => setOpen(rows[i].crmUser)}
          rows={rows.map((r) => [
            r.rank || '—',
            <>
              <Av name={r.name} s={24} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</span>
            </>,
            r.attendance ?? '—',
            r.assessment ?? '—',
            r.coding ?? '—',
            r.project ?? '—',
            <b style={{ fontSize: 13 }}>{r.total == null ? '—' : Math.round(r.total)}</b>,
            <Chip tone={r.level.tone} dot>
              {r.level.label}
            </Chip>,
          ])}
          empty={loading ? 'Loading…' : 'No learners in this batch.'}
        />
      </Card>
    </Screen>
  );
}
