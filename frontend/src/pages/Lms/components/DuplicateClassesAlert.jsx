import React, { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';

// DATA-02 — duplicate classes of a batch (same day, overlapping time or the
// same title, not started). "Request removal" sends it to the Ops approvals
// queue; once approved the system removes the extra class. The hourly job
// raises the same request on its own, so this mostly shows the state.
// Renders nothing when there are no duplicates.
const when = (d) => new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const REQ = { pending: ['adh', 'Waiting for Ops'], approved: ['hai', 'Removed'], rejected: ['gray', 'Ops kept it'] };

export default function DuplicateClassesAlert({ load, request, batch, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState('');
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
  if (!groups.length) return null;
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
    <div className="ld-warn" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <b>Duplicate classes · {groups.reduce((n, g) => n + g.extras.length, 0)} (DATA-02)</b>
      {groups.map((g) => (
        <div key={`${g.batch}-${g.day}-${g.keep.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>{g.batch} · keep <b>{g.keep.title}</b> ({when(g.keep.start)})</span>
          {g.extras.map((e) => {
            const st = e.request && REQ[e.request];
            return (
              <span key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 12 }}>
                <span>duplicate: {e.title} · {when(e.start)}</span>
                {st ? <span className={`ld-chip ${st[0]}`}>{st[1]}</span> : (
                  <button type="button" className="ld-btn2 xs" disabled={busy === e.id} onClick={() => ask(e)}>Request removal</button>
                )}
              </span>
            );
          })}
        </div>
      ))}
      <span className="ld-muted" style={{ fontSize: 12 }}>Once Ops approves, the extra class is removed automatically · class numbers are put back in sequence</span>
    </div>
  );
}
