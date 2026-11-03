import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Skeleton, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './onboarding.css';

// Learner onboarding checklist (design L10, backend lmsController/
// onboarding.js). Policies / batch / readiness come from real records; the
// learner ticks calendar and setup themselves, and the device check runs in
// this browser (camera + microphone permission, browser name).

const ICON = { done: '✓', blocked: '!', todo: '○', self: '○' };
const CHIP = { done: ['ok', 'Done'], blocked: ['bad', 'Blocked'], todo: ['gray', 'Pending'], self: ['gray', 'Pending'] };

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

  return (
    <div className="sh-root lms-portal">
      <div className="sh-head">
        <div>
          <div className="sh-muted" style={{ fontWeight: 700, letterSpacing: '0.06em', fontSize: 12 }}>ACTIVATION + ONBOARDING</div>
          <h1>Welcome, {(d.name || '').split(' ')[0]} — chaliye setup poora karein</h1>
          <div className="sh-sub">{[d.batch, d.pmName && `Project Manager: ${d.pmName}`].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <div className="ob-grid">
        <section className="sh-card" aria-label="Checklist">
          <div className="sh-card-hd">
            <b>Checklist</b>
            <span className={`sh-chip ${d.done === d.total ? 'ok' : 'info'}`}>
              {d.done} / {d.total} done
            </span>
          </div>
          <div className="sh-bar" role="img" aria-label={`${d.done} of ${d.total} done`}>
            <span style={{ width: `${Math.round((d.done / d.total) * 100)}%` }} />
          </div>
          <ol className="ob-steps">
            {d.steps.map((s) => (
              <li key={s.key} className={s.state}>
                <span className="ob-ic" aria-hidden="true">
                  {ICON[s.state]}
                </span>
                <span className="ob-body">
                  <b>{s.title}</b>
                  <span className="sh-muted">{s.note}</span>
                </span>
                <span className="ob-act">
                  {s.key === 'device' && s.state !== 'done' && (
                    <Button size="small" loading={busy === 'device'} onClick={deviceCheck}>
                      {s.state === 'blocked' ? 'Check again' : 'Run check'}
                    </Button>
                  )}
                  {(s.key === 'calendar' || s.key === 'setup') && s.state === 'self' && (
                    <Button size="small" loading={busy === s.key} onClick={() => mark(s.key, { done: true })}>
                      Mark done
                    </Button>
                  )}
                  {s.link && s.state !== 'done' && (
                    <Button size="small" type="link" onClick={() => navigate(s.link)}>
                      Open
                    </Button>
                  )}
                  {s.state === 'blocked' && (
                    <Button size="small" type="link" onClick={() => ticketFor(s)}>
                      Raise ticket
                    </Button>
                  )}
                  <span className={`sh-chip ${CHIP[s.state][0]}`}>{CHIP[s.state][1]}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="sh-stack">
          <section className="sh-card" aria-label="Setup guide">
            <b>Setup guide</b>
            <ol className="ob-guide">
              <li>Python 3.11 install karein (python.org)</li>
              <li>VS Code + Python extension</li>
              <li>
                <code>pip install -r requirements.txt</code>
              </li>
              <li>Test notebook run karein</li>
            </ol>
            <button type="button" className="sh-link" onClick={() => navigate('/learn/material')}>
              Setup material →
            </button>
            <div className="sh-muted">Remote install sirf aapki explicit permission se.</div>
          </section>
          <section className="sh-card" aria-label="Supported devices">
            <b>Supported devices</b>
            <div style={{ fontSize: 14 }}>Chrome / Edge latest · 8 GB RAM · webcam + mic · 5 Mbps</div>
            <div className="sh-muted">Safari par camera issue aate hain — Chrome use karein.</div>
          </section>
          <section className="sh-card" aria-label="Stuck">
            <b>Atak gaye?</b>
            <div className="sh-muted">Kisi bhi step par &quot;Raise ticket&quot; se Support Manager ko seedha ticket jaata hai.</div>
            <button type="button" className="sh-link" onClick={() => navigate('/learn/support')}>
              Raise a ticket
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
