import React, { useCallback, useEffect, useState } from 'react';
import { Empty, Skeleton, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// Learner onboarding checklist (design L10, backend lmsController/
// onboarding.js). Policies / batch / readiness come from real records; the
// learner ticks calendar and setup themselves, and the device check runs in
// this browser (camera + microphone permission, browser name).

const ICON = { done: '✓', blocked: '!', todo: '○', self: '○' };
const CHIP = { done: ['hai', 'Done'], blocked: ['red', 'Blocked'], todo: ['gray', 'Pending'], self: ['gray', 'Pending'] };

function browserName() {
  const ua = navigator.userAgent || '';
  const m = ua.match(/Edg\/(\d+)/) || ua.match(/Chrome\/(\d+)/) || ua.match(/Firefox\/(\d+)/) || ua.match(/Version\/(\d+).*Safari/);
  if (!m) return 'Unknown browser';
  const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari';
  return `${name} ${m[1]}`;
}

async function runDeviceCheck() {
  const out = { camera: false, microphone: false, browser: browserName() };
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return out;
  for (const kind of ['video', 'audio']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const stream = await md.getUserMedia({ [kind]: true });
      stream.getTracks().forEach((t) => t.stop());
      out[kind === 'video' ? 'camera' : 'microphone'] = true;
    } catch (e) {
      /* denied or no device */
    }
  }
  return out;
}

export default function Onboarding() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const r = await lmsApi.myOnboarding().catch(() => null);
    setD((r && r.success !== false && r.result) || null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const mark = async (step, body) => {
    setBusy(step);
    const r = await lmsApi.markOnboarding(step, body).catch(() => null);
    setBusy(null);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not save.');
      return;
    }
    setD(r.result);
  };
  const deviceCheck = async () => {
    setBusy('device');
    const device = await runDeviceCheck();
    setBusy(null);
    await mark('device', { done: true, device });
    if (!device.camera || !device.microphone) message.warning('Camera or microphone not available — allow access in the browser, or raise a ticket.');
  };
  const ticketFor = (s) =>
    navigate('/learn/support', { state: { raise: { category: 'Login / Technical', subject: `Stuck on onboarding: ${s.title}`, reference: s.note, description: 'What I tried:\nWhat happens:' } } });

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="Could not load your onboarding." />;

  // design board L10 — checklist card (task rows: icon · title/note · action + chip) | setup guide, devices, stuck
  const IC_STYLE = { done: { background: '#dcfce7', color: '#166534' }, blocked: { background: '#fee2e2', color: '#991b1b' } };
  return (
    <div className="ld-page">
      <div className="ld-hd">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="ld-eyebrow">Activation + onboarding</div>
          <h1>Welcome, {(d.name || '').split(' ')[0]} — chaliye setup poora karein</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>{[d.batch && `${d.batch} batch`, d.pmName && `Project Manager: ${d.pmName}`].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', flex: 1 }}>
        <section className="ld-card" aria-label="Checklist">
          <div className="ld-hd"><b style={{ fontSize: 16 }}>Checklist</b><span style={{ fontSize: 14, fontWeight: 700 }}>{d.done} / {d.total} done</span></div>
          <div style={{ height: 10, background: '#e2e8f0', borderRadius: 5 }} role="img" aria-label={`${d.done} of ${d.total} done`}>
            <div style={{ height: 10, borderRadius: 5, background: '#0e7490', width: `${Math.round((d.done / d.total) * 100)}%` }} />
          </div>
          {d.steps.map((s) => (
            <div key={s.key} className={`ob-task ${s.state}`} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12, alignItems: 'center', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, ...(IC_STYLE[s.state] || { background: '#f1f5f9', color: '#475569' }) }}>{ICON[s.state]}</div>
              <div style={{ fontSize: 14, lineHeight: '19px' }}><b>{s.title}</b><br /><span className="ld-muted" style={{ fontSize: 13 }}>{s.note}</span></div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {s.key === 'device' && s.state !== 'done' && (
                  <button type="button" className="ld-btn2 sm" disabled={busy === 'device'} onClick={deviceCheck}>{busy === 'device' ? 'Checking…' : s.state === 'blocked' ? 'Check again' : 'Run check'}</button>
                )}
                {(s.key === 'calendar' || s.key === 'setup') && s.state === 'self' && (
                  <button type="button" className="ld-btn2 sm" disabled={busy === s.key} onClick={() => mark(s.key, { done: true })}>Mark done</button>
                )}
                {s.link && s.state !== 'done' && <button type="button" className="ld-btn2 sm" onClick={() => navigate(s.link)}>Open</button>}
                {s.state === 'blocked' && <button type="button" className="ld-btn2 sm" onClick={() => ticketFor(s)}>Raise ticket</button>}
                <span className={`ld-chip ${CHIP[s.state][0]}`}>{CHIP[s.state][1]}</span>
              </div>
            </div>
          ))}
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="ld-card" aria-label="Setup guide">
            <b style={{ fontSize: 16 }}>Setup guide</b>
            <div style={{ fontSize: 13, lineHeight: '21px' }}>1. Python 3.11 install karein<br />2. VS Code + Python extension<br />3. <code>pip install -r requirements.txt</code><br />4. Test notebook run karein</div>
            <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/material')}>Setup material →</button>
            <div className="ld-muted" style={{ fontSize: 12 }}>Remote install sirf aapki explicit permission se</div>
          </section>
          <section className="ld-card" aria-label="Supported devices">
            <b style={{ fontSize: 16 }}>Supported devices</b>
            <div style={{ fontSize: 13, lineHeight: '21px' }}>Chrome / Edge latest · 8 GB RAM · webcam + mic · 5 Mbps</div>
            <div className="ld-warn">Safari par camera issue aate hain — Chrome use karein</div>
          </section>
          <section className="ld-card" aria-label="Stuck">
            <b style={{ fontSize: 16 }}>Atak gaye?</b>
            <div className="ld-muted" style={{ fontSize: 13 }}>Blocked step par &quot;Raise ticket&quot; se Support Manager ko seedha ticket jaata hai.</div>
            <button type="button" className="ld-btn2" style={{ alignSelf: 'flex-start', height: 36 }} onClick={() => navigate('/learn/support')}>Raise a ticket</button>
          </section>
        </div>
      </div>
    </div>
  );
}
