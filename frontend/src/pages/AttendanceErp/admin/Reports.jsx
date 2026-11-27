import React, { useState } from 'react';
import api from '../api';
import { ErrorState, Kpi, Name, Select, Seg, Skeleton, hm, todayKey, useLoad, usePager, useToast } from '../ui';
import { deptOptions, empOptions, useLite } from './shared';

// A7 · Reports — monthly attendance (+ the other report types as views of it)
export default function Reports({ setTab }) {
  const lite = useLite();
  const toast = useToast();
  const [kind, setKind] = useState('monthly');
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [employee, setEmployee] = useState('All');
  const [dept, setDept] = useState('All');
  const { data, loading, error, reload } = useLoad(() => api.get('admin/reports/monthly', { month, employee, dept }), [month, employee, dept]);
  const rows = data ? [...data.rows].sort((a, b) => (kind === 'late' ? b.lateDays - a.lateDays : kind === 'hours' ? b.workMin - a.workMin : a.employee.name.localeCompare(b.employee.name))) : [];
  const pg = usePager(rows, 15);
  const dl = async (format) => {
    const ok = await api.download('admin/export', { kind: kind === 'leave' ? 'leaves' : 'monthly', format, month, employee, dept }, `attendance-${month}.${format}`);
    if (!ok) toast.err('Export failed');
  };
  const months = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i, 1);
    const v = d.toLocaleDateString('en-CA').slice(0, 7);
    return { value: v, label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) };
  });
  const k = data && data.kpis;
  const sum = (f) => rows.reduce((n, r) => n + (r[f] || 0), 0);
  return (
    <div className="e-page">
      <div className="e-head">
        <div>
          <h1 className="e-h1">Reports</h1>
          <p className="e-sub">Hours are actual active work only. Overtime = work above {data ? Math.round(data.required / 60) : 8}h on a working day.</p>
        </div>
        <div className="e-row e-noprint">
          <button type="button" className="e-btn" onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className="e-btn" onClick={() => dl('csv')}>
            CSV
          </button>
          <button type="button" className="e-btn p" onClick={() => dl('xlsx')}>
            Export Excel
          </button>
        </div>
      </div>
      <div className="e-noprint">
        <Seg
          value={kind}
          onChange={(v) => (v === 'daily' ? setTab('attendance') : setKind(v))}
          options={[
            ['monthly', 'Monthly attendance'],
            ['daily', 'Daily summary'],
            ['late', 'Late & early'],
            ['leave', 'Leave balance'],
            ['hours', 'Working hours'],
          ]}
        />
      </div>
      <div className="e-row e-noprint">
        <Select label="Month" value={month} onChange={setMonth} options={months} />
        <Select label="Employee" value={employee} onChange={setEmployee} options={empOptions(lite)} style={{ maxWidth: 230 }} />
        <Select label="Department" value={dept} onChange={setDept} options={deptOptions(lite)} />
        <span className="e-inp">
          <span className="l">Shift</span> General
        </span>
        <button
          type="button"
          className="e-btn ghost"
          onClick={() => {
            setEmployee('All');
            setDept('All');
            setMonth(todayKey().slice(0, 7));
          }}
        >
          Reset
        </button>
      </div>
      {loading && !data ? (
        <Skeleton kpis={5} rows={8} />
      ) : error && !data ? (
        <ErrorState onRetry={() => reload()} />
      ) : (
        <>
          <div className="e-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <Kpi label="Working days" value={k.workingDays} sub="weekly offs + holidays left out" />
            <Kpi label="Avg attendance" value={`${k.attendancePct}%`} sub={k.attendanceDelta === null ? 'no data for last month' : `${k.attendanceDelta >= 0 ? '+' : ''}${k.attendanceDelta}% vs last month`} />
            <Kpi label="Avg actual work / day" value={hm(k.avgWork)} sub={`target ${hm(data.required)}`} />
            <Kpi label="Late logins" value={k.lateLogins} sub={k.topLate ? `most: ${k.topLate.name} (${k.topLate.n})` : 'nobody late'} />
            <Kpi label="Overtime" value={hm(k.overtime)} sub="all employees" />
          </div>
          <section className="e-card">
            <div className="e-tw">
              <table className="e-tbl" style={{ minWidth: 1040 }}>
                <colgroup>
                  <col style={{ width: '22%' }} />
                  {kind === 'leave' ? null : (
                    <>
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col />
                      <col style={{ width: '11%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '9%' }} />
                    </>
                  )}
                </colgroup>
                <thead>
                  {kind === 'leave' ? (
                    <tr>
                      <th>Employee</th>
                      {lite.leaveTypes.map((t) => (
                        <th key={t} className="r">
                          {t} left / total
                        </th>
                      ))}
                    </tr>
                  ) : (
                    <tr>
                      <th>Employee</th>
                      <th className="r">Working days</th>
                      <th className="r">Present</th>
                      <th className="r">Absent</th>
                      <th className="r">Leaves</th>
                      <th className="r">Half days</th>
                      <th className="r">Late days</th>
                      <th className="r">Active hours</th>
                      <th className="r">Avg / day</th>
                      <th className="r">Overtime</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {pg.rows.map((r) =>
                    kind === 'leave' ? (
                      <LeaveRow key={r.employee._id} r={r} types={lite.leaveTypes} />
                    ) : (
                      <tr key={r.employee._id}>
                        <td>
                          <Name name={r.employee.name} sub={r.employee.department || r.employee.role} size={28} photo={r.employee.photo} />
                        </td>
                        <td className="r">{r.workingDays}</td>
                        <td className="r">{r.present}</td>
                        <td className="r" style={r.absent > 1 ? { color: '#B91C1C', fontWeight: 600 } : undefined}>
                          {r.absent}
                        </td>
                        <td className="r">{r.leaves}</td>
                        <td className="r">{r.halfDays}</td>
                        <td className="r" style={r.lateDays > 4 ? { color: '#B45309', fontWeight: 600 } : undefined}>
                          {r.lateDays}
                        </td>
                        <td className="r strong">{hm(r.workMin)}</td>
                        <td className="r" style={{ color: r.avgMin >= data.required ? '#15803D' : r.avgMin ? '#B91C1C' : undefined, fontWeight: 600 }}>
                          {r.avgMin ? hm(r.avgMin) : '—'}
                        </td>
                        <td className="r">{hm(r.overtimeMin)}</td>
                      </tr>
                    )
                  )}
                </tbody>
                {kind !== 'leave' && rows.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>All {rows.length} employees</td>
                      <td className="r">{data.workingDays}</td>
                      <td className="r">{sum('present')}</td>
                      <td className="r">{sum('absent')}</td>
                      <td className="r">{sum('leaves')}</td>
                      <td className="r">{sum('halfDays')}</td>
                      <td className="r">{sum('lateDays')}</td>
                      <td className="r">{hm(sum('workMin'))}</td>
                      <td className="r">{hm(k.avgWork)}</td>
                      <td className="r">{hm(sum('overtimeMin'))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <div className="e-foot">
              <span>
                Showing {pg.from}–{pg.to} of {rows.length} · Print view drops the sidebar and fits A4 landscape
              </span>
              <pg.Pager />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// Leave balance view loads each employee's balance from Employees
function LeaveRow({ r, types }) {
  const [bal, setBal] = useState(null);
  React.useEffect(() => {
    let live = true;
    api.get('admin/employees', { q: r.employee.email || r.employee.name }).then((x) => {
      if (!live || !x.success) return;
      const e = x.result.list.find((y) => String(y._id) === String(r.employee._id));
      setBal(e ? e.balance : []);
    });
    return () => {
      live = false;
    };
  }, [r.employee._id, r.employee.email, r.employee.name]);
  return (
    <tr>
      <td>
        <Name name={r.employee.name} sub={r.employee.department || r.employee.role} size={28} />
      </td>
      {types.map((t) => {
        const b = bal && bal.find((x) => x.type === t);
        return (
          <td key={t} className="r">
            {b ? `${b.left} / ${b.total}` : '…'}
          </td>
        );
      })}
    </tr>
  );
}
