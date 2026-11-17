import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { message } from 'antd';

// DATA-02 — duplicate classes of a batch (same day, overlapping time or the
// same title, not started). "Request removal" sends it to the Ops approvals
// queue; once approved the system removes the extra class. The hourly job
// raises the same request on its own, so this mostly shows the state.
// Renders nothing when there are no duplicates.
//
// Layout: a compact summary card (count, batches, request states) that
// opens into a per-batch table — the full list used to fill the dashboard.
const dayOf = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
const timeOf = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
// "OCT262330PM — Class 26" → "Class 26" (the batch is already the section heading)
const short = (t, batch) => String(t || '').replace(new RegExp(`^${String(batch || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—-]\\s*`), '');
const REQ = { pending: ['adh', 'Waiting for Ops'], approved: ['hai', 'Removed'], rejected: ['gray', 'Ops kept it'] };

export default function DuplicateClassesAlert({ load, request, batch, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState('');
  const refresh = useCallback(async () => {
    try {
      const r = await load();
      setGroups(((r && r.result && r.result.groups) || []).filter((g) => !batch || g.batch === batch));
    } catch (e) {
      setGroups([]);
    }
  }, [load, batch]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const byBatch = useMemo(() => {
    const m = new Map();
    groups.forEach((g) => {
      if (!m.has(g.batch)) m.set(g.batch, []);
      m.get(g.batch).push(g);
    });
    return [...m.entries()].map(([name, list]) => ({ name, list, extras: list.reduce((n, g) => n + g.extras.length, 0) }));
  }, [groups]);

  if (!groups.length) return null;

  const extras = groups.flatMap((g) => g.extras);
  const waiting = extras.filter((e) => e.request === 'pending').length;
  const unsent = extras.filter((e) => !e.request).length;
  const shown = only ? byBatch.filter((b) => b.name === only) : byBatch;

  const ask = async (e) => {
    setBusy(e.id);
    try {
      const r = await request(e.id, 'Duplicate entry in the calendar');
      if (r && r.success === false) throw new Error(r.message);
      message.success((r && r.message) || 'Sent to Ops.');
      await refresh();
      if (onChanged) onChanged();
    } catch (err) {
      message.error((err && err.response && err.response.data && err.response.data.message) || (err && err.message) || 'Could not send.');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="dup-card" role="alert" aria-label="Duplicate classes">
      <div className="dup-head">
        <span className="dup-icon" aria-hidden="true">!</span>
        <div className="dup-title">
          <b>{extras.length} duplicate class{extras.length === 1 ? '' : 'es'} in the calendar</b>
          <span>The same batch has two classes at the same date and time. The extra copy is removed once Ops approves, and class numbers are put back in order.</span>
        </div>
        <button type="button" className="ld-btn2 sm dup-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide list' : 'View list'}
        </button>
      </div>

      <div className="dup-stats">
        <span className="dup-stat"><b>{byBatch.length}</b> batch{byBatch.length === 1 ? '' : 'es'}</span>
        {waiting > 0 && <span className="dup-stat adh"><b>{waiting}</b> waiting for Ops</span>}
        {unsent > 0 && <span className="dup-stat red"><b>{unsent}</b> not sent to Ops yet</span>}
        <span className="dup-sep" />
        {byBatch.map((b) => (
          <button
            key={b.name}
            type="button"
            className={`dup-batch${only === b.name ? ' on' : ''}`}
            onClick={() => {
              setOnly(only === b.name ? '' : b.name);
              setOpen(true);
            }}
          >
            {b.name} <i>{b.extras}</i>
          </button>
        ))}
      </div>

      {open && (
        <div className="dup-body">
          {shown.map((b) => (
            <div key={b.name} className="dup-group">
              <div className="dup-ghead">{b.name} <span>{b.extras} extra</span></div>
              <div className="dup-table" role="table">
                <div className="dup-row th" role="row">
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Time</span>
                  <span role="columnheader">Keep</span>
                  <span role="columnheader">Duplicate</span>
                  <span role="columnheader">Status</span>
                </div>
                {b.list.map((g) => g.extras.map((e, i) => {
                  const st = e.request && REQ[e.request];
                  return (
                    <div key={e.id} className={`dup-row${i ? ' cont' : ''}`} role="row">
                      <span role="cell" className="dup-date">{i ? '' : dayOf(g.keep.start)}</span>
                      <span role="cell" className="ld-muted">{i ? '' : timeOf(g.keep.start)}</span>
                      <span role="cell" className="dup-keep">{i ? '' : short(g.keep.title, b.name)}</span>
                      <span role="cell" className="dup-extra">{short(e.title, b.name)}</span>
                      <span role="cell">
                        {st ? <span className={`ld-chip ${st[0]}`}>{st[1]}</span> : (
                          <button type="button" className="ld-btn2 xs" disabled={busy === e.id} onClick={() => ask(e)}>Request removal</button>
                        )}
                      </span>
                    </div>
                  );
                }))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
