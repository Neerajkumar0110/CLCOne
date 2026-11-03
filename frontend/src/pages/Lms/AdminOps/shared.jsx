import React, { useCallback, useEffect, useState } from 'react';
import { Modal, message } from 'antd';

// Small helpers shared by the Admin & Ops screens.

export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const reload = useCallback(() => {
    setLoading(true);
    return Promise.resolve(fn())
      .then((r) => {
        if (r && r.success === false) throw new Error(r.message || 'Request failed');
        setData((r && r.result) || null);
        setErr(null);
      })
      .catch((e) => setErr(e.message || 'Could not load.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, loading, err, reload, setData };
}

// Runs an API write, shows the server's message on failure, returns the result.
export async function act(promise, okText) {
  try {
    const r = await promise;
    if (r && r.success === false) {
      message.error(r.message || 'Action failed');
      return null;
    }
    if (okText) message.success((r && r.result && r.result.message) || okText);
    return (r && r.result) || {};
  } catch (e) {
    message.error((e && e.message) || 'Action failed');
    return null;
  }
}

// Asks for the mandatory reason before an audited action.
export function askReason(title, onOk, placeholder = 'Reason (saved in the audit log)') {
  let value = '';
  Modal.confirm({
    title,
    icon: null,
    content: <textarea className="ao-inp full" aria-label="Reason" placeholder={placeholder} style={{ height: 80, padding: 8, marginTop: 8 }} onChange={(e) => (value = e.target.value)} />,
    okText: 'Confirm',
    onOk: () => {
      if (value.trim().length < 3) {
        message.error('Please write a reason.');
        return Promise.reject(new Error('reason'));
      }
      return onOk(value.trim());
    },
  });
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
export const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const money = (n) => {
  const v = Number(n || 0);
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

export function Head({ title, sub, right }) {
  return (
    <div className="ao-head">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1>{title}</h1>
        {sub && <div className="ao-muted ao-sub">{sub}</div>}
      </div>
      {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{right}</div>}
    </div>
  );
}

export function Loading({ loading, err, data, children }) {
  if (err && !data) return <div className="ao-err">{err}</div>;
  if (loading && !data) return <div className="ao-empty">Loading…</div>;
  return children;
}
