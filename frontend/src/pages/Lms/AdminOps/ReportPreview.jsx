import React, { useMemo, useState } from 'react';
import { Modal, Button, DatePicker, Input, Table, Spin } from 'antd';
import { CalendarOutlined, SearchOutlined, TeamOutlined, ClockCircleOutlined, CloseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

// Report preview (2026-11-27): readable instead of one mixed table —
//  · pick ONE day (re-fetched from the server for that date only)
//  · rows with a Date + Class are grouped per class, with present/absent counts
//  · status filter pills, search, columns wrap instead of being cut off.
// Report dates come as UTC "YYYY-MM-DD HH:MM" (adminOps2.js d()).
const asDate = (v) => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const x = new Date(s.length > 10 ? `${s.replace(' ', 'T')}:00Z` : `${s}T00:00:00Z`);
  return Number.isNaN(x.getTime()) ? null : x;
};
const DATE_COL = /^(date|started|when|created|sent|at|submitted)$/i;
const STATUS_TONE = { Active: 'ok', Dropped: 'bad', Completed: 'info', Inactive: 'mid', PRESENT: 'ok', LATE: 'mid', ABSENT: 'bad', EXCUSED: 'info', yes: 'ok', no: 'bad', SUBMITTED: 'ok', FAILED: 'bad', sent: 'ok', failed: 'bad' };

export default function ReportPreview({ preview, loading, day, onDay, rangeLabel, onClose }) {
  const [q, setQ] = useState('');
  const [st, setSt] = useState('all');
  const cols = (preview && preview.columns) || [];
  const dateCol = cols.find((c) => DATE_COL.test(c));
  const statusCol = cols.find((c) => /^status$/i.test(c));
  const groupCol = cols.find((c) => /^class$/i.test(c)) && dateCol ? 'Class' : null;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ((preview && preview.rows) || []).filter((r) => (st === 'all' || String(r[statusCol]) === st) && (!needle || Object.values(r).join(' ').toLowerCase().includes(needle)));
  }, [preview, q, st, statusCol]);
  const statusCounts = useMemo(() => ((preview && preview.rows) || []).reduce((m, r) => (statusCol ? { ...m, [r[statusCol]]: (m[r[statusCol]] || 0) + 1 } : m), {}), [preview, statusCol]);

  const groups = useMemo(() => {
    if (!groupCol) return null;
    const map = new Map();
    rows.forEach((r) => {
      const k = `${r[dateCol]}|${r.Batch || ''}|${r[groupCol]}`;
      if (!map.has(k)) map.set(k, { key: k, at: asDate(r[dateCol]), batch: r.Batch || '', title: r[groupCol], rows: [] });
      map.get(k).rows.push(r);
    });
    return [...map.values()];
  }, [rows, groupCol, dateCol]);

  // the columns a group table shows (date / batch / class are in its header)
  const inner = cols.filter((c) => !groupCol || ![dateCol, 'Batch', groupCol].includes(c));
  // first name-like column stays visible while scrolling sideways
  const nameCol = cols.find((c) => /^(name|learner|student|project)$/i.test(c));
  const colDefs = (list) => list.map((c) => ({
    title: c,
    dataIndex: c,
    ...(c === nameCol ? { fixed: 'left', width: 180 } : {}),
    ...(/^e-?mail$/i.test(c) ? { width: 240 } : {}),
    ...(/^(batch|course|class|test)$/i.test(c) ? { width: c === 'Course' || c === 'Class' ? 260 : 140 } : {}),
    render: (v) => {
      if (c === statusCol && v) return <span className={`rpv-st ${STATUS_TONE[v] || ''}`}>{v}</span>;
      if (c === dateCol) { const x = asDate(v); return x ? dayjs(x).format('D MMM YYYY, h:mm A') : v; }
      return v === '' || v == null ? <span className="rpv-dash">—</span> : String(v);
    },
    ...(c === statusCol ? { width: 110 } : {}),
    ...((/^(minutes|rows|score|out_of|versions|warnings)$/i.test(c) || /%|qualified|attempted|pending|count/i.test(c)) ? { width: 110, align: 'center' } : {}),
  }));

  return (
    <Modal open={!!preview || loading} width={1100} onCancel={onClose} footer={null} centered destroyOnClose rootClassName="mg-modal">
      <div className="mg-m">
        <div className="mg-m-head">
          <span className="mg-act">Preview</span>
          <h3>{preview ? preview.name : 'Loading…'}</h3>
          <span>
            {preview ? `${preview.total} row${preview.total === 1 ? '' : 's'}${preview.total > 200 ? ' · first 200 shown — download for all' : ''}` : ''}
            {' · '}{day ? dayjs(day).format('ddd, D MMM YYYY') : rangeLabel}
          </span>
        </div>
        <div className="rpv-bar">
          {dateCol && (
            <span className="rpv-day">
              <CalendarOutlined />
              <DatePicker value={day ? dayjs(day) : null} onChange={(d) => onDay(d ? d.format('YYYY-MM-DD') : null)} placeholder="Pick one day" format="D MMM YYYY" allowClear={false} size="small" />
              {day ? <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => onDay(null)}>All dates</Button> : <small>or showing the whole period</small>}
            </span>
          )}
          <Input allowClear size="small" prefix={<SearchOutlined />} placeholder="Search name, email, class…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          {statusCol && Object.keys(statusCounts).length > 1 && (
            <span className="rpv-pills">
              <button type="button" className={`rpv-pill${st === 'all' ? ' on' : ''}`} onClick={() => setSt('all')}>All · {preview.rows.length}</button>
              {Object.entries(statusCounts).map(([k, n]) => (
                <button key={k} type="button" className={`rpv-pill ${STATUS_TONE[k] || ''}${st === k ? ' on' : ''}`} onClick={() => setSt(k)}>{k} · {n}</button>
              ))}
            </span>
          )}
        </div>
        <div className="mg-m-body rpv-body">
          {loading ? <div className="rpv-load"><Spin /></div> : !rows.length ? (
            <div className="mg-empty">No rows{day ? ' on this day' : ''} for these filters.</div>
          ) : groups ? (
            groups.map((g) => {
              const by = g.rows.reduce((m, r) => ({ ...m, [r[statusCol]]: (m[r[statusCol]] || 0) + 1 }), {});
              const present = (by.PRESENT || 0) + (by.LATE || 0);
              return (
                <section key={g.key} className="rpv-grp">
                  <div className="rpv-grp-hd">
                    <span className="rpv-grp-date">{g.at ? <><b>{dayjs(g.at).format('D')}</b><small>{dayjs(g.at).format('MMM')}</small></> : '—'}</span>
                    <div className="rpv-grp-t">
                      <b>{g.title}</b>
                      <small>{g.batch && <><TeamOutlined /> {g.batch} · </>}{g.at && <><ClockCircleOutlined /> {dayjs(g.at).format('ddd, h:mm A')}</>}</small>
                    </div>
                    {statusCol && (
                      <span className="rpv-grp-c">
                        <span className="rpv-st ok">{present} present</span>
                        {by.ABSENT ? <span className="rpv-st bad">{by.ABSENT} absent</span> : null}
                        <span className="rpv-grp-pct">{Math.round((present / g.rows.length) * 100)}%</span>
                      </span>
                    )}
                  </div>
                  <Table size="small" pagination={false} rowKey={(_, i) => i} dataSource={g.rows} columns={colDefs(inner)} scroll={{ x: 'max-content' }} />
                </section>
              );
            })
          ) : (
            <Table size="small" pagination={false} rowKey={(_, i) => i} dataSource={rows} columns={colDefs(cols)} scroll={{ x: 'max-content', y: 460 }} />
          )}
        </div>
        <div className="mg-m-foot"><Button type="primary" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  );
}
