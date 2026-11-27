import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { B, Skeleton, dateLabel, todayKey, useLoad, useToast } from '../ui';
import { usePortal } from './ctx';

// E5 · Apply Leave + success
const TYPES = ['Casual', 'Sick', 'Earned', 'Emergency', 'Other'];

export default function ApplyLeave() {
  const toast = useToast();
  const fileRef = useRef(null);
  const bal = useLoad(() => api.get('me/leaves'), []);
  const cal = useLoad(() => api.get('me/calendar', { month: todayKey().slice(0, 7) }), []);
  const [f, setF] = useState({ leaveType: 'Casual', fromDate: todayKey(), toDate: todayKey(), dayType: 'full', reason: '' });
  const [file, setFile] = useState(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const portal = usePortal();
  const weeklyOff = (portal && portal.today && portal.today.settings.weeklyOff) || [0];
  const balance = bal.data ? bal.data.balance : [];
  const b = balance.find((x) => x.type === f.leaveType);
  // working days in the range (weekly offs from settings via calendar data)
  const days = useMemo(() => {
    if (!f.fromDate || !f.toDate || f.toDate < f.fromDate) return 0;
    if (f.fromDate === f.toDate && f.dayType !== 'full') return 0.5;
    const off = new Set(((cal.data && cal.data.days) || []).filter((d) => d.weeklyOff || d.holiday).map((d) => d.dayKey));
    let n = 0;
    for (let d = new Date(`${f.fromDate}T12:00:00+05:30`); d <= new Date(`${f.toDate}T12:00:00+05:30`); d = new Date(d.getTime() + 864e5)) {
      const k = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (!off.has(k) && !weeklyOff.includes(d.getUTCDay())) n += 1;
    }
    return n;
  }, [f, cal.data, weeklyOff]);
  const pick = (fl) => {
    if (!fl) return;
    if (fl.size > 5 * 1024 * 1024) return toast.err('The file is larger than 5 MB');
    if (!/^(application\/pdf|image\/(png|jpe?g))$/.test(fl.type)) return toast.err('Attach a PDF, JPG or PNG');
    setFile(fl);
  };
  const submit = async () => {
    setBusy(true);
    const form = new FormData();
    Object.entries(f).forEach(([k, v]) => form.append(k, v));
    if (file) form.append('attachment', file);
    const r = await api.upload('me/leaves', form);
    setBusy(false);
    if (r.success) {
      setSent(r.result);
      toast.ok('Request sent', 'HR has been emailed.');
      bal.reload(true);
    } else toast.err(r.message || 'Could not send the request');
  };
  if (bal.loading && !bal.data) return <Skeleton rows={6} />;
  return (
    <div className="e-page">
      <div>
        <Link to="/employee/leaves" style={{ fontSize: 13, textDecoration: 'none' }}>
          ← My leaves
        </Link>
        <h1 className="e-h1" style={{ marginTop: 8 }}>
          Apply for leave
        </h1>
        <p className="e-sub">HR gets an email straight away. You'll see the answer here and in your inbox.</p>
      </div>
      <div className="e-split">
        <form
          className="e-card pad main"
          style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 24 }}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <span className="e-lbl" style={{ fontSize: 13 }}>
              Leave type
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }} role="radiogroup">
              {TYPES.map((t) => {
                const x = balance.find((y) => y.type === t);
                const on = f.leaveType === t;
                return (
                  <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setF({ ...f, leaveType: t })} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: on ? 13 : 14, border: on ? '2px solid var(--e-pri)' : '1px solid var(--e-line)', background: on ? 'var(--e-priS)' : 'var(--e-card)', borderRadius: 12, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--e-ink)' }}>
                    <b style={{ fontSize: 14 }}>{t}</b>
                    <span style={{ color: 'var(--e-mut)', fontSize: 12 }}>{t === 'Other' && (!x || !x.total) ? 'unpaid' : `${x ? x.left : 0} days left`}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="e-fgrid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            <label>
              <span className="e-lbl" style={{ fontSize: 13 }}>
                From date
              </span>
              <input className="e-fld" style={{ height: 44, fontSize: 14, borderRadius: 10 }} type="date" min={todayKey()} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} />
            </label>
            <label>
              <span className="e-lbl" style={{ fontSize: 13 }}>
                To date
              </span>
              <input className="e-fld" style={{ height: 44, fontSize: 14, borderRadius: 10 }} type="date" min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} />
            </label>
            <label>
              <span className="e-lbl" style={{ fontSize: 13 }}>
                Day type
              </span>
              <select className="e-fld" style={{ height: 44, fontSize: 14, borderRadius: 10 }} value={f.fromDate === f.toDate ? f.dayType : 'full'} disabled={f.fromDate !== f.toDate} onChange={(e) => setF({ ...f, dayType: e.target.value })}>
                <option value="full">Full day</option>
                <option value="first">First half</option>
                <option value="second">Second half</option>
              </select>
            </label>
          </div>
          <div className="e-note" style={{ background: 'var(--e-priS)', color: 'var(--e-priD)', fontSize: 13 }}>
            Duration:{' '}
            <b>
              {days} working day{days === 1 ? '' : 's'}
            </b>
            . Sundays and holidays inside the dates are not counted.
          </div>
          <label>
            <span className="e-lbl" style={{ fontSize: 13 }}>
              Reason
            </span>
            <textarea className="e-fld" style={{ minHeight: 110, fontSize: 14, borderRadius: 10, padding: '12px 14px' }} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Personal work" />
            <span style={{ display: 'block', textAlign: 'right', fontSize: 11, color: 'var(--e-mut)', marginTop: 4 }}>{f.reason.length} / 500</span>
          </label>
          <div>
            <span className="e-lbl" style={{ fontSize: 13 }}>
              Attachment (optional)
            </span>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files[0]);
              }}
              style={{ border: `1.5px dashed ${drag ? 'var(--e-pri)' : '#CBD5E1'}`, borderRadius: 12, padding: 22, textAlign: 'center', fontSize: 13, color: 'var(--e-mut)', background: drag ? 'var(--e-priS)' : undefined }}
            >
              {file ? (
                <span>
                  <b style={{ color: 'var(--e-ink)' }}>{file.name}</b> · {Math.round(file.size / 1024)} KB{' '}
                  <button type="button" className="e-btn ghost sm" onClick={() => setFile(null)}>
                    Remove
                  </button>
                </span>
              ) : (
                <>
                  Drop a file here or{' '}
                  <button type="button" className="e-btn ghost sm" style={{ padding: 0, height: 'auto' }} onClick={() => fileRef.current && fileRef.current.click()}>
                    browse
                  </button>
                  <div style={{ fontSize: 12, marginTop: 4 }}>PDF, JPG or PNG, up to 5 MB. A doctor's note helps for 2+ sick days.</div>
                </>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => pick(e.target.files[0])} />
            </div>
          </div>
          <div className="e-row" style={{ justifyContent: 'flex-end' }}>
            <Link to="/employee/leaves" className="e-btn lg">
              Cancel
            </Link>
            <button type="submit" className="e-btn p lg" disabled={busy || !f.reason.trim() || !days}>
              {busy ? 'Sending…' : 'Submit request'}
            </button>
          </div>
        </form>
        <aside className="side">
          <section className="e-card pad" style={{ padding: 24 }}>
            <h2 className="e-ct" style={{ marginBottom: 6, fontSize: 16 }}>
              Summary
            </h2>
            <div className="e-tot">
              <span>{f.leaveType} balance now</span>
              <b>{b ? `${b.left} days` : '—'}</b>
            </div>
            <div className="e-tot">
              <span>This request</span>
              <b>− {days} day{days === 1 ? '' : 's'}</b>
            </div>
            <div className="e-tot" style={{ borderBottom: 0 }}>
              <span>After approval</span>
              <b style={{ color: b && b.left - days < 0 ? '#B91C1C' : 'var(--e-priD)' }}>{b ? `${Math.max(0, b.left - days)} days` : '—'}</b>
            </div>
            {b && b.total > 0 && days > b.left && <div className="e-note err" style={{ marginTop: 10 }}>You only have {b.left} {f.leaveType} day(s) left this year.</div>}
            {b && b.pending > 0 && <div className="e-note warn" style={{ marginTop: 10 }}>You already have {b.pending} {f.leaveType} day(s) waiting for approval.</div>}
          </section>
          {sent && (
            <section className="e-card pad" style={{ padding: 24, borderColor: '#BBF7D0', background: 'rgba(22,163,74,.05)' }}>
              <div className="e-row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: '#16A34A', color: '#fff', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>✓</span>
                <div>
                  <b style={{ fontSize: 15 }}>Request sent</b>
                  <div style={{ fontSize: 12, color: '#15803D' }}>{dateLabel(new Date())}</div>
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--e-ink2)', marginTop: 12, lineHeight: '20px' }}>
                {sent.leaveType} Leave · {sent.label} · {sent.days} day{sent.days === 1 ? '' : 's'}
              </div>
              <div style={{ marginTop: 10 }}>
                <B>Pending</B>
              </div>
              <div style={{ fontSize: 12, color: 'var(--e-mut)', marginTop: 10, lineHeight: '18px' }}>HR has been emailed. You'll get an email and a notification here when they answer.</div>
              <Link to="/employee/leaves" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginTop: 12, textDecoration: 'none' }}>
                View my leaves →
              </Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
