import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { usePortal } from './ctx';
import { Av, ErrorState, Skeleton, clock, dateLabel, useLoad, useToast } from '../ui';

// E7 · Profile + Notifications
const KIND = (type = '') => {
  if (/approved|counted/.test(type)) return ['✓', 'rgba(22,163,74,.13)', '#15803D'];
  if (/rejected/.test(type)) return ['✕', 'rgba(220,38,38,.11)', '#B91C1C'];
  if (/correction/.test(type)) return ['✎', 'rgba(124,58,237,.12)', '#6D28D9'];
  if (/leave/.test(type)) return ['L', 'rgba(245,158,11,.15)', '#B45309'];
  return ['i', 'rgba(37,99,235,.12)', '#1D4ED8'];
};

export default function Profile({ focus }) {
  const portal = usePortal();
  const toast = useToast();
  const notesRef = useRef(null);
  const p = useLoad(() => api.get('me/profile'), []);
  const n = useLoad(() => api.get('me/notifications'), [], { poll: 60000 });
  useEffect(() => {
    if (focus === 'notifications' && notesRef.current) notesRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, n.data]);
  const readAll = async () => {
    const r = await api.post('me/notifications/read-all');
    toast.res(r, 'All marked as read');
    n.reload(true);
    portal.reload && portal.reload();
  };
  if (p.loading && !p.data) return <Skeleton rows={6} />;
  if (p.error && !p.data) return <ErrorState onRetry={() => p.reload()} />;
  const x = p.data;
  return (
    <div className="e-split" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, order: focus === 'notifications' ? 2 : 0 }}>
        <section className="e-card pad" style={{ padding: 24 }}>
          <div className="e-row" style={{ gap: 16 }}>
            <Av name={x.name} size={64} photo={x.photo} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <h1 style={{ fontSize: 20 }}>{x.name}</h1>
              <div style={{ fontSize: 13, color: 'var(--e-mut)', marginTop: 2 }}>{[x.designation, x.department].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <div className="e-kv2" style={{ marginTop: 22, gap: 16 }}>
            <div>
              Employee code<b style={{ fontWeight: 500 }}>{x.employeeCode || '—'}</b>
            </div>
            <div>
              Joining date<b style={{ fontWeight: 500 }}>{x.joiningDate ? dateLabel(x.joiningDate) : '—'}</b>
            </div>
            <div>
              Work email<b style={{ fontWeight: 500 }} title={x.email}>
                {x.email}
              </b>
            </div>
            <div>
              Reports to<b style={{ fontWeight: 500 }}>{x.reportsTo || '—'}</b>
            </div>
            <div>
              Shift<b style={{ fontWeight: 500 }}>{x.shift}</b>
            </div>
            <div>
              Weekly off<b style={{ fontWeight: 500 }}>{x.weeklyOff}</b>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 18 }}>Details are managed by HR. Ask HR to change anything here.</div>
        </section>
        <section className="e-card pad" style={{ padding: 24 }}>
          <h2 className="e-ct" style={{ marginBottom: 4 }}>
            Security
          </h2>
          <div className="e-rule">
            <span style={{ flex: 1 }}>Password</span>
            <Link to="/forgetpassword" className="e-btn sm">
              Change
            </Link>
          </div>
          <div className="e-rule">
            <span style={{ flex: 1 }}>
              Signed in on
              <div style={{ fontSize: 12, color: 'var(--e-mut)' }}>{x.signedIn ? `${[x.signedIn.device && x.signedIn.device.browser, x.signedIn.device && x.signedIn.device.os].filter(Boolean).join(' · ') || 'This browser'} · since ${clock(x.signedIn.at)} today` : 'Not signed in today'}</div>
            </span>
            <span style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>This device</span>
          </div>
          <div className="e-rule">
            <span style={{ flex: 1 }}>Desktop agent</span>
            <Link to="/employee/agent" className="e-btn sm">
              Open
            </Link>
          </div>
          <div className="e-rule" style={{ borderBottom: 0 }}>
            <span style={{ flex: 1 }}>Email me when a leave is answered</span>
            <span style={{ fontSize: 12, color: 'var(--e-mut)' }}>Always on</span>
          </div>
        </section>
      </div>
      <section ref={notesRef} className="e-card" style={{ flex: '1 1 420px', minWidth: 0 }}>
        <div className="e-ch">
          <div>
            <h2 className="e-ct">
              Notifications{' '}
              {n.data && n.data.unread > 0 && <span style={{ fontSize: 11, background: '#DC2626', color: '#fff', borderRadius: 999, padding: '1px 7px', marginLeft: 4 }}>{n.data.unread} new</span>}
            </h2>
          </div>
          <button type="button" className="e-btn sm" onClick={readAll}>
            Mark all read
          </button>
        </div>
        {n.loading && !n.data && <Skeleton rows={4} />}
        {n.data && n.data.list.length === 0 && <p className="e-cs" style={{ padding: 20 }}>No notifications yet. Leave answers, corrections and announcements show here.</p>}
        {n.data &&
          n.data.list.map((x2) => {
            const [k, bg, c] = KIND(x2.type);
            return (
              <div key={x2._id} className="e-row" style={{ gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--e-line2)', flexWrap: 'nowrap', alignItems: 'flex-start', background: x2.readAt ? undefined : 'rgba(79,70,229,.04)' }}>
                <span style={{ flex: 'none', width: 32, height: 32, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, background: bg, color: c }}>{k}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--e-ink)', fontWeight: x2.readAt ? 400 : 600 }}>{x2.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 2 }}>{x2.body}</div>
                  <div style={{ fontSize: 11, color: 'var(--e-mut)', marginTop: 4 }}>
                    {dateLabel(x2.created, { year: false })}, {clock(x2.created)}
                  </div>
                </div>
                {!x2.readAt && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--e-pri)', marginTop: 6, flex: 'none' }} />}
              </div>
            );
          })}
      </section>
    </div>
  );
}
