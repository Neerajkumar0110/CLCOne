import React, { useEffect, useState } from 'react';
import { Drawer, Skeleton, message } from 'antd';
import lmsApi from '../api';
import '../components/LearnerDesign.css';

// Learner's view of one class (design L4): where the class is in its
// lifecycle, the same Join flow the card uses (device pre-check + wait for
// host live in the parent), their own attendance for it, details and private
// notes. Chat and captions live inside the meeting itself (BigBlueButton), so
// they aren't duplicated here.

const STEPS = ['Scheduled', 'Open for join', 'Live', 'Ended', 'Recording ready'];
function stepOf(r) {
  switch (r.status) {
    case 'STARTING':
      return 1;
    case 'LIVE':
      return 2;
    case 'ENDING':
    case 'ENDED':
    case 'RECORDING_PROCESSING':
      return 3;
    case 'RECORDING_AVAILABLE':
      return 4;
    default:
      return r.canJoin ? 1 : 0;
  }
}
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const clock = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
function browserName() {
  const ua = navigator.userAgent || '';
  const m = ua.match(/Edg\/(\d+)/) || ua.match(/Chrome\/(\d+)/) || ua.match(/Firefox\/(\d+)/) || ua.match(/Version\/(\d+).*Safari/);
  if (!m) return 'Unknown browser';
  const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari';
  return `${name} ${m[1]}`;
}

export default function ClassDetailDrawer({ row, onClose, onJoin, joining, deviceCheckRequired, onOpenRecordings }) {
  const [att, setAtt] = useState(undefined); // undefined = loading, null = none
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [noteAt, setNoteAt] = useState(null);
  const [noteLoading, setNoteLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details');
  const [check, setCheck] = useState(null); // null | 'running' | { camera, microphone, browser }
  const id = row && row.id;

  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setAtt(undefined);
    setNoteLoading(true);
    lmsApi
      .studentAttendance()
      .then((r) => {
        const classes = (r && r.result && r.result.classes) || [];
        if (alive) setAtt(classes.find((c) => c.id === id) || null);
      })
      .catch(() => alive && setAtt(null));
    lmsApi
      .liveMyNote(id)
      .then((r) => {
        if (!alive) return;
        const n = (r && r.success !== false && r.result) || {};
        setNote(n.text || '');
        setSavedNote(n.text || '');
        setNoteAt(n.updated || null);
      })
      .catch(() => {})
      .finally(() => alive && setNoteLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const saveNote = async () => {
    if (note === savedNote) return;
    setSaving(true);
    const r = await lmsApi.saveLiveMyNote(id, note).catch(() => null);
    setSaving(false);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not save your notes.');
      return;
    }
    setSavedNote(r.result.text);
    setNoteAt(r.result.updated);
  };

  if (!row) return null;
  const step = stepOf(row);
  const cancelled = row.status === 'CANCELLED';
  const liveFor = row.status === 'LIVE' && row.startedAt ? Math.max(0, Math.round((Date.now() - new Date(row.startedAt).getTime()) / 60000)) : null;
  const runCheck = async () => {
    setCheck('running');
    const out = { camera: false, microphone: false, browser: browserName() };
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
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
    }
    setCheck(out);
  };
  const okText = (v) => (check && check !== 'running' ? (v ? <b style={{ color: '#166534' }}>OK</b> : <b style={{ color: '#991b1b' }}>Not available</b>) : <span className="ld-muted">—</span>);

  // design board L4 — lifecycle bar, meeting area + pre-join check + join | side panel tabs
  return (
    <Drawer open={!!row} onClose={() => { saveNote(); onClose(); }} width="min(1180px, 100vw)" title={null} destroyOnClose styles={{ body: { padding: 0 } }}>
      <div className="ld-page cd-root">
        <div className="ld-head">
          <div>
            <h1 style={{ fontSize: 26 }}>{row.title}</h1>
            <div className="ld-muted ld-sub">
              {when(row.scheduledStart)}{row.scheduledEnd ? `–${clock(row.scheduledEnd)}` : ''} IST · Project Manager: {row.teacherName || 'TBD'}
            </div>
          </div>
          <button type="button" className="ld-btn2 sm" onClick={() => { saveNote(); onClose(); }}>Close</button>
        </div>

        {cancelled ? (
          <span className="ld-chip gray" style={{ alignSelf: 'flex-start' }}>Cancelled</span>
        ) : (
          <ol className="ld-steps cd-steps" aria-label="Class status" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {STEPS.map((s, i) => (
              <li key={s} className={`ld-stp${i < step ? ' past' : i === step ? (s === 'Live' ? ' live' : ' on') : ''}`} aria-current={i === step ? 'step' : undefined}>
                {s === 'Live' && i === step ? `LIVE${liveFor !== null ? ` · ${liveFor} min` : ''}` : s}
              </li>
            ))}
          </ol>
        )}

        <div className="ld-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ minHeight: 300, background: '#0f172a', borderRadius: 12, padding: 12, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ background: '#1e293b', borderRadius: 8, padding: 12, color: '#e2e8f0', fontSize: 14, width: '100%' }}>
                {row.status === 'LIVE' ? 'Class live hai — "Join class" dabane par BigBlueButton naye tab mein khulega.' : 'Class shuru hone par yahin se join karein.'}
              </div>
            </div>
            <div className="ld-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <section className="ld-card" aria-label="Pre-join check">
                <div className="ld-hd"><b>Pre-join check</b><button type="button" className="ld-btn2 sm" disabled={check === 'running'} onClick={runCheck}>{check === 'running' ? 'Checking…' : check ? 'Check again' : 'Run check'}</button></div>
                <div className="ld-li"><span>Camera permission</span>{okText(check && check.camera)}</div>
                <div className="ld-li"><span>Microphone</span>{okText(check && check.microphone)}</div>
                <div className="ld-li"><span>Browser{check && check !== 'running' ? ` (${check.browser})` : ''}</span>{check && check !== 'running' ? <b style={{ color: /Chrome|Edge/.test(check.browser) ? '#166534' : '#9a3412' }}>{/Chrome|Edge/.test(check.browser) ? 'Supported' : 'Use Chrome'}</b> : <span className="ld-muted">—</span>}</div>
              </section>
              <section className="ld-card" aria-label="Join">
                <div className="ld-hd"><b>Join</b></div>
                {row.canJoin ? (
                  <>
                    <div className="ld-muted" style={{ fontSize: 13 }}>{deviceCheckRequired ? 'Pehle camera / mic check chalega. ' : ''}One-time secure ticket · link kabhi page par nahi dikhta.</div>
                    <button type="button" className="ld-btn" disabled={joining} onClick={() => onJoin(row)}>{joining ? 'Joining…' : 'Join class'}</button>
                  </>
                ) : row.status === 'RECORDING_AVAILABLE' ? (
                  <button type="button" className="ld-btn2" onClick={onOpenRecordings}>Watch recording</button>
                ) : (
                  <div className="ld-muted" style={{ fontSize: 13 }}>{cancelled ? 'This class was cancelled.' : step >= 3 ? 'This class has finished.' : 'You can join once the project manager starts the class.'}</div>
                )}
                <div className="ld-muted" style={{ fontSize: 12 }}>
                  {att === undefined
                    ? 'Loading your attendance…'
                    : att && (att.attendedMin || att.joins)
                      ? `Your attendance: ${att.status || ''}${att.firstJoinAt ? ` · joined ${clock(att.firstJoinAt)}` : ''} · ${att.attendedMin} min${att.joins > 1 ? ` · ${att.joins - 1} reconnect merged` : ''}`
                      : step >= 2
                        ? 'No attendance recorded for you in this class.'
                        : 'Attendance is recorded automatically once you join.'}
                </div>
              </section>
            </div>
          </div>

          <section className="ld-card" aria-label="Class panel" style={{ gap: 12 }}>
            <div className="ld-tabs">
              {[['details', 'Details'], ['chat', 'Chat'], ['notes', 'Notes'], ['trans', 'Transcript']].map(([k, l]) => (
                <button key={k} type="button" className={`ld-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {tab === 'details' && (
              <div className="cd-details" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
                <div><span className="ld-muted">Batch</span><br /><b>{row.batchName || '—'}</b></div>
                <div><span className="ld-muted">Topic / module</span><br /><b>{(typeof row.topic === 'string' && row.topic) || row.courseTitle || '—'}</b></div>
                <div><span className="ld-muted">Materials</span><br /><a href="/learn/material" onClick={(e) => { e.preventDefault(); onClose(); window.location.assign('/learn/material'); }}>Study material</a></div>
                <div><span className="ld-muted">Recording</span><br />{row.recording && row.recording.enabled ? <><b style={{ color: '#b91c1c' }}>Recording ON</b> <span className="ld-muted">(notice shown before join)</span></> : <b>Not recorded</b>}</div>
              </div>
            )}
            {tab === 'chat' && <div className="ld-muted" style={{ fontSize: 13 }}>Chat class ke andar (BigBlueButton) hoti hai aur sirf is batch ko dikhti hai.</div>}
            {tab === 'notes' &&
              (noteLoading ? (
                <Skeleton active paragraph={{ rows: 3 }} title={false} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea aria-label="My notes" className="ld-inp full" style={{ height: 240, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} maxLength={20000} placeholder="Your private notes for this class — only you can see them." />
                  <div className="ld-hd">
                    <span className="ld-muted" style={{ fontSize: 12 }}>{saving ? 'Saving…' : note !== savedNote ? 'Unsaved changes' : noteAt ? `Saved ${when(noteAt)}` : 'Private notes · saved to your account'}</span>
                    <button type="button" className="ld-btn2 sm" onClick={saveNote} disabled={note === savedNote || saving}>Save notes</button>
                  </div>
                </div>
              ))}
            {tab === 'trans' && <div className="ld-muted" style={{ fontSize: 13 }}>Live captions / transcript abhi set up nahi hai — class ke baad recording Recordings mein milegi.</div>}
          </section>
        </div>
      </div>
    </Drawer>
  );
}
