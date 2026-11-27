import React, { useState } from 'react';
import api from '../api';
import { B, Card, DateInp, Empty, ErrorState, Modal, ModalHead, Name, Search, Select, Skeleton, Trunc, clock, hmShort, todayKey, useErpLive, useLoad, usePager, useToast } from '../ui';
import { ExportMenu, deptOptions, useLite } from './shared';

// A14 · Inactivity log — a record of every 5 min without keyboard and mouse
const SRC = { agent: { background: 'var(--e-priS)', color: 'var(--e-priD)' }, browser: { background: 'var(--e-line2)', color: '#475569' } };

export default function IdleLog({ onChanged, globalQ }) {
  const lite = useLite();
  const toast = useToast();
  const [q, setQ] = useState(globalQ || '');
  const [date, setDate] = useState(todayKey());
  const [employee, setEmployee] = useState('All');
  const [dept, setDept] = useState('All');
  const [source, setSource] = useState('All');
  const [min, setMin] = useState(0);
  const [decision, setDecision] = useState('all');
  const [count, setCount] = useState(null);
  const [reason, setReason] = useState('');
  const { data, loading, error, reload } = useLoad(() => api.get('admin/idle', { date, q, employee, dept, source, min: min || undefined, decision: decision === 'all' ? undefined : decision }), [date, q, employee, dept, source, min, decision], { poll: date === todayKey() ? 30000 : 0 });
  useErpLive(() => date === todayKey() && reload(true));
  const list = (data && data.list) || [];
  const pg = usePager(list, 12);
  const submitCount = async () => {
    const r = await api.post(`admin/idle/${count._id}/count`, { reason });
    toast.res(r, 'Counted as work');
    if (r.success) {
      setCount(null);
      setReason('');
      reload(true);
      onChanged && onChanged();
    }
  };
  if (loading && !data) return <Skeleton kpis={6} rows={10} />;
  if (error && !data) return <ErrorState onRetry={() => reload()} />;
  const k = data.kpis;
  const maxTop = Math.max(1, ...data.top.map((t) => t.min));
  const hours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((h) => ({ h, n: (data.hours.find((x) => x.hour === h) || {}).n || 0 }));
  const maxH = Math.max(1, ...hours.map((x) => x.n));
  const peak = [...hours].sort((a, b) => b.n - a.n).slice(0, 2).filter((x) => x.n);
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Inactivity log</h1>
          <p className="e-sub">
            A row is saved on its own every time the keyboard and mouse are both unused for <b>5 minutes</b>. It keeps the last input time, when the employee came back, how long it lasted and what the laptop was doing. Rows can't be deleted. An admin can only mark one as "count as work" with a reason, and that goes into the audit log.
          </p>
        </div>
        <ExportMenu kind="idle" params={{ date }} primary />
      </div>
      <div className="e-kpis sm" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
        <div className="e-kpi">
          <div className="e-kl">Inactive records {date === todayKey() ? 'today' : ''}</div>
          <div className="e-kv">{k.count}</div>
          <div className="e-ks">{k.people} employees</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Total inactive time</div>
          <div className="e-kv" style={{ color: '#B45309' }}>
            {hmShort(k.total)}
          </div>
          <div className="e-ks">left out of work hours</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Longest</div>
          <div className="e-kv">{k.longest ? `${k.longest.minutes}m` : '—'}</div>
          <div className="e-ks">{k.longest ? `${k.longest.name.split(' ')[0]} · ${clock(k.longest.from)}–${k.longest.to ? clock(k.longest.to) : 'now'}` : 'nothing yet'}</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Most records</div>
          <div className="e-kv">{k.most ? k.most.n : '—'}</div>
          <div className="e-ks">{k.most ? k.most.name : 'nothing yet'}</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Still inactive now</div>
          <div className="e-kv" style={{ color: k.open ? '#B91C1C' : undefined }}>
            {k.open}
          </div>
          <div className="e-ks">open records</div>
        </div>
        <div className="e-kpi">
          <div className="e-kl">Counted as work</div>
          <div className="e-kv" style={{ color: '#15803D' }}>
            {k.counted}
          </div>
          <div className="e-ks">meetings, calls — approved</div>
        </div>
      </div>
      <section className="e-card e-filters">
        <div className="e-row">
          <Search value={q} onChange={setQ} placeholder="Search employee" style={{ flex: '1 1 200px' }} />
          <DateInp label="Date" value={date} onChange={(v) => setDate(v || todayKey())} />
          <Select label="Employee" value={employee} onChange={setEmployee} options={[{ value: 'All', label: 'All' }, ...data.employees.map((e) => ({ value: e._id, label: e.name }))]} style={{ maxWidth: 220 }} />
          <Select label="Department" value={dept} onChange={setDept} options={deptOptions(lite)} />
          <Select label="Source" value={source} onChange={setSource} options={['All', 'Agent', 'Browser']} />
          <button
            type="button"
            className="e-btn ghost"
            onClick={() => {
              setQ('');
              setDate(todayKey());
              setEmployee('All');
              setDept('All');
              setSource('All');
              setMin(0);
              setDecision('all');
            }}
          >
            Reset
          </button>
        </div>
        <div className="e-row" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--e-mut)', marginRight: 4 }}>Duration</span>
          {[0, 10, 20, 30].map((m) => (
            <button key={m} type="button" className={`e-chip${min === m ? ' on' : ''}`} onClick={() => setMin(m)}>
              {m || 5} min +
            </button>
          ))}
          <span style={{ width: 12 }} />
          <span style={{ fontSize: 12, color: 'var(--e-mut)', marginRight: 4 }}>Decision</span>
          {[
            ['all', 'All'],
            ['notwork', 'Not work'],
            ['counted', 'Counted as work'],
            ['note', 'Has employee note'],
          ].map(([v, l]) => (
            <button key={v} type="button" className={`e-chip${decision === v ? ' on' : ''}`} onClick={() => setDecision(v)}>
              {l}
            </button>
          ))}
        </div>
      </section>
      <section className="e-card">
        {list.length === 0 ? (
          <Empty title="No inactive records" text={k.count ? 'Nothing matches these filters.' : 'Nobody went 5 minutes without keyboard and mouse on this day.'} />
        ) : (
          <>
            <div className="e-tw">
              <table className="e-tbl" style={{ minWidth: 1080 }}>
                <colgroup>
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Last input</th>
                    <th>Inactive at</th>
                    <th>Back at</th>
                    <th>Inactive</th>
                    <th>Laptop during</th>
                    <th>Source</th>
                    <th>Employee note</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((p) => {
                    const open = !p.endAt;
                    const dec = p.countedAsWork ? 'Counted as work' : open ? 'Still inactive' : 'Not work';
                    return (
                      <tr key={p._id} style={open ? { background: 'rgba(220,38,38,.03)' } : undefined}>
                        <td>
                          <Name name={p.emp.name} size={28} photo={p.emp.photo} />
                        </td>
                        <td>{clock(p.lastInputAt)}</td>
                        <td>{clock(p.startAt)}</td>
                        <td style={open ? { color: '#B91C1C', fontWeight: 600 } : undefined}>{open ? 'now' : clock(p.endAt)}</td>
                        <td>
                          <b style={{ color: p.minutes >= 20 ? '#B91C1C' : 'var(--e-ink)' }}>{p.minutes}m</b>
                        </td>
                        <td>
                          <Trunc text={p.laptop || '—'} />
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, ...(SRC[p.source || 'browser'] || SRC.browser) }}>{p.source === 'agent' ? 'Agent' : 'Browser'}</span>
                        </td>
                        <td style={{ color: 'var(--e-mut)' }}>
                          <Trunc text={p.employeeNote || '—'} />
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <B sm>{dec}</B>
                            {!p.countedAsWork && !open && (
                              <button type="button" className="e-btn sm" style={{ height: 26, padding: '0 8px' }} onClick={() => setCount(p)}>
                                Count as work
                              </button>
                            )}
                          </span>
                          {p.countedAsWork && <Trunc text={`${p.countedBy}: ${p.countedReason}`} style={{ fontSize: 11, color: 'var(--e-mut)' }} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="e-foot">
              <span>
                Showing {pg.from}–{pg.to} of {list.length} · "Inactive at" = last input + 5 min. Only the time after that counts as inactive.
              </span>
              <pg.Pager />
            </div>
          </>
        )}
      </section>
      <div className="e-grid e-g2">
        <Card title="Who was inactive most · this month" sub="Records and total inactive time">
          {data.top.length === 0 && <p className="e-cs">No inactive time this month.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.top.map((t) => (
              <div key={t.name}>
                <div className="e-row" style={{ fontSize: 12, marginBottom: 6, gap: 8, flexWrap: 'nowrap' }}>
                  <Trunc text={t.name} style={{ flex: 1, color: 'var(--e-ink2)' }} />
                  <span style={{ color: 'var(--e-mut)' }}>{t.n} records</span>
                  <b>{hmShort(t.min)}</b>
                </div>
                <div className="e-bar" style={{ height: 8 }}>
                  <i style={{ width: `${(t.min / maxTop) * 100}%`, background: t.min / maxTop > 0.7 ? '#F59E0B' : '#FCD34D' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="When people go inactive" sub="Records per hour, last 30 days">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150 }} role="img" aria-label="Inactive records per hour of the day">
            {hours.map((x) => (
              <div key={x.h} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' }}>
                <span style={{ fontSize: 10, color: 'var(--e-mut)' }}>{x.n}</span>
                <div style={{ width: '100%', maxWidth: 36, borderRadius: '5px 5px 2px 2px', height: `${Math.round((x.n / maxH) * 110)}px`, background: x.n / maxH >= 0.8 ? '#F59E0B' : '#FCD34D' }} />
                <span style={{ fontSize: 10, color: 'var(--e-ink2)' }}>{x.h}:00</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 10 }}>{peak.length ? `Peak at ${peak.map((p) => `${p.h}:00`).join(' and ')}.` : 'No data yet.'}</div>
        </Card>
      </div>
      <Modal open={!!count} onClose={() => setCount(null)} label="Count as work">
        <ModalHead title="Count this inactive time as work?" sub={count ? `${count.emp.name} · ${clock(count.startAt)}–${clock(count.endAt)} · ${count.minutes} min${count.employeeNote ? ` · note: “${count.employeeNote}”` : ''}` : ''} onClose={() => setCount(null)} />
        <label>
          <span className="e-lbl">Reason (required — saved in the audit log)</span>
          <textarea className="e-fld" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Team stand-up in the meeting room" autoFocus />
        </label>
        <div className="e-row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="e-btn" onClick={() => setCount(null)}>
            Cancel
          </button>
          <button type="button" className="e-btn ok" disabled={!reason.trim()} onClick={submitCount}>
            Count as work
          </button>
        </div>
      </Modal>
    </div>
  );
}
