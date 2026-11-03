import React, { useEffect, useState } from 'react';
import { Drawer, Skeleton, message } from 'antd';
import lmsApi from '../api';
import '../components/LearnerDesign.css';
import './classDetail.css';

// Learner's view of one class (design L4): where the class is in its
// lifecycle, the same Join flow the card uses (device pre-check + wait for
// host live in the parent), their own attendance for it, details and private
// notes. Chat and captions live inside the meeting itself (BigBlueButton), so
// they aren't duplicated here. ClassBoard is the board itself (the learner's
// Live Classes page renders it inline); the default export wraps it in a
// drawer for the class list.

const STEPS = ['Scheduled', 'Open for join', 'Live', 'Grace / closing', 'Ended', 'Recording ready'];
function stepOf(r) {
  switch (r.status) {
    case 'STARTING':
      return 1;
    case 'LIVE':
      return 2;
    case 'ENDING':
      return 3;
    case 'ENDED':
    case 'RECORDING_PROCESSING':
      return 4;
    case 'RECORDING_AVAILABLE':
      return 5;
    default:
      return r.canJoin ? 1 : 0;
  }
}
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const clock = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
function dayLabel(v) {
  if (!v) return '';
  const d = new Date(v);
  const today = new Date();
  const tmr = new Date();
  tmr.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tmr.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
const hms = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};
// "S78 · title" like the board, unless the title already carries the number
// (auto-generated classes are named "<batch> — Class 87").
export function classTitle(r) {
  const n = r.sessionIndex;
  if (!n || new RegExp(`\\b${n}\\b`).test(r.title || '')) return r.title;
  return `S${n} · ${r.title}`;
}
function browserName() {
  const ua = navigator.userAgent || '';
  const m = ua.match(/Edg\/(\d+)/) || ua.match(/Chrome\/(\d+)/) || ua.match(/Firefox\/(\d+)/) || ua.match(/Version\/(\d+).*Safari/);
  if (!m) return 'Unknown browser';
  const name = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'Safari';
  return `${name} ${m[1]}`;
}
async function runDeviceCheck() {
  const out = { camera: false, microphone: false, speaker: false, browser: browserName() };
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
  try {
    const devs = md && md.enumerateDevices ? await md.enumerateDevices() : [];
    // Firefox/Safari don't list outputs — the system default still plays
    out.speaker = devs.some((x) => x.kind === 'audiooutput') || !/Chrome|Edge/.test(out.browser);
  } catch (e) {
    out.speaker = false;
  }
  return out;
}
// Already-granted camera + mic: fill the check in without a permission prompt.
async function permissionsGranted() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return false;
    const [c, m] = await Promise.all([navigator.permissions.query({ name: 'camera' }), navigator.permissions.query({ name: 'microphone' })]);
    return c.state === 'granted' && m.state === 'granted';
  } catch (e) {
    return false;
  }
}

// Class chat (design L4 "Chat sirf is batch ko dikhti hai") — backend
// classChat.js; polls for new messages every 4 s while the tab is open.
function ClassChat({ id }) {
  const [msgs, setMsgs] = useState(null); // null = loading
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const boxRef = React.useRef(null);
  const lastRef = React.useRef(null);

  useEffect(() => {
    let alive = true;
    lastRef.current = null;
    setMsgs(null);
    const pull = async () => {
      const r = await lmsApi.liveChat(id, lastRef.current).catch(() => null);
      if (!alive) return;
      if (!r || r.success === false) {
        setErr((r && r.message) || 'Chat load nahi hua.');
        setMsgs((m) => m || []);
        return;
      }
      setErr('');
      const add = r.result.messages || [];
      if (add.length) lastRef.current = add[add.length - 1].created;
      setMsgs((m) => {
        const have = new Set((m || []).map((x) => x.id));
        return [...(m || []), ...add.filter((x) => !have.has(x.id))];
      });
    };
    pull();
    const t = setInterval(pull, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [msgs && msgs.length]);

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setSending(true);
    const r = await lmsApi.sendLiveChat(id, v).catch(() => null);
    setSending(false);
    if (!r || r.success === false) return message.error((r && r.message) || 'Message nahi gaya.');
    setText('');
    lastRef.current = r.result.created;
    setMsgs((m) => [...(m || []), r.result]);
    return null;
  };
  const remove = async (m) => {
    const r = await lmsApi.removeLiveChat(id, m.id).catch(() => null);
    if (r && r.success !== false) setMsgs((xs) => xs.filter((x) => x.id !== m.id));
  };

  if (msgs === null) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
      <div ref={boxRef} className="cd-chat" aria-live="polite">
        {msgs.length === 0 && <div className="ld-muted" style={{ fontSize: 13 }}>Abhi koi message nahi. Pehla sawaal poochiye!</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`cd-cmsg${m.mine ? ' mine' : ''}`}>
            <b>{m.mine ? 'You' : m.authorName}{m.authorRole === 'teacher' ? ' (PM)' : ''}:</b> {m.text}
            <span className="ld-muted"> · {clock(m.created)}</span>
            {m.canDelete && (
              <button type="button" className="ld-link" style={{ marginLeft: 6, fontSize: 12 }} aria-label="Remove message" onClick={() => remove(m)}>Remove</button>
            )}
          </div>
        ))}
      </div>
      {err && <div className="ld-warn">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="ld-inp"
          style={{ flex: 1, minWidth: 0 }}
          aria-label="Chat message"
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message likhein…"
        />
        <button type="button" className="ld-btn sm" disabled={sending || !text.trim()} onClick={send}>Send</button>
      </div>
      <div className="ld-muted" style={{ fontSize: 12 }}>Chat sirf is batch ko dikhti hai · Project Manager messages hata sakte hain</div>
    </div>
  );
}

export function ClassBoard({ row, meName, onJoin, joining, deviceCheckRequired, onOpenRecordings, onOpenMaterial, onClose, beforeClose }) {
  const [att, setAtt] = useState(undefined); // undefined = loading, null = none
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [noteAt, setNoteAt] = useState(null);
  const [noteLoading, setNoteLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details');
  const [check, setCheck] = useState(null); // null | 'running' | { camera, microphone, speaker, browser }
  const [now, setNow] = useState(Date.now());
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

  useEffect(() => {
    let alive = true;
    permissionsGranted().then((ok) => ok && runDeviceCheck().then((r) => alive && setCheck(r)));
    return () => {
      alive = false;
    };
  }, []);

  const isLive = row && row.status === 'LIVE';
  useEffect(() => {
    if (!isLive) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isLive]);

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
  if (beforeClose) beforeClose.current = saveNote;

  if (!row) return null;
  const step = stepOf(row);
  const cancelled = row.status === 'CANCELLED';
  const liveSince = isLive && row.actualStart ? hms(now - new Date(row.actualStart).getTime()) : null;
  const runCheck = async () => {
    setCheck('running');
    setCheck(await runDeviceCheck());
  };
  const done = check && check !== 'running';
  const okText = (v, yes = 'OK', no = 'Not available') => (done ? (v ? <b style={{ color: '#166534' }}>{yes}</b> : <b style={{ color: '#991b1b' }}>{no}</b>) : <span className="ld-muted">—</span>);
  const title = classTitle(row);
  const range = `${clock(row.scheduledStart)}${row.scheduledEnd ? `–${clock(row.scheduledEnd)}` : ''}`;
  const online = Number(row.participantsOnline) || 0;
  const learners = Number(row.participantCount) || 0;
  const statusLine = isLive
    ? 'Class live hai — "Join class" dabane par BigBlueButton naye tab mein khulega.'
    : cancelled
      ? 'Yeh class cancel ho gayi.'
      : step >= 4
        ? 'Class khatam ho chuki hai.'
        : 'Class shuru hone par yahin se join karein.';

  // design board L4 — lifecycle bar, meeting area + pre-join check + join | side panel tabs
  return (
    <div className="ld-page cd-root">
      <div className="ld-head">
        <div>
          <h1 style={{ fontSize: 26 }}>{title}</h1>
          <div className="ld-muted ld-sub">
            {dayLabel(row.scheduledStart)} {range} IST · Project Manager: {row.teacherName || 'TBD'} · Join window: {range}
          </div>
        </div>
        {onClose && <button type="button" className="ld-btn2 sm" onClick={onClose}>Close</button>}
      </div>

      {cancelled ? (
        <span className="ld-chip gray" style={{ alignSelf: 'flex-start' }}>Cancelled</span>
      ) : (
        <ol className="ld-steps cd-steps" aria-label="Class status" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s} className={`ld-stp${i < step ? ' past' : i === step ? (s === 'Live' ? ' live' : ' on') : ''}`} aria-current={i === step ? 'step' : undefined}>
              {s === 'Live' && i === step ? `LIVE${liveSince ? ` · ${liveSince}` : ''}` : s}
            </li>
          ))}
        </ol>
      )}

      <div className="ld-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 380px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="cd-stage" aria-label="Class room">
            <div className="cd-tile cd-main">
              <span className="cd-msg">{statusLine}</span>
              <span>{row.teacherName || 'Project Manager'} · {isLive ? 'host · class live' : step >= 4 ? 'host · class ended' : 'host'}</span>
            </div>
            <div className="cd-tile">
              {meName ? `${meName} (you)` : 'You'}
              {att && att.firstJoinAt ? ` · joined ${clock(att.firstJoinAt)}` : isLive ? ' · not joined yet' : ''}
            </div>
            <div className="cd-tile">{isLive ? `${online} online now` : `Batch ${row.batchName || ''}`}</div>
            <div className="cd-tile">
              {learners ? `${learners} joined this class` : step >= 4 ? 'Is class mein koi join nahi hua' : 'Abhi tak koi join nahi hua'}
            </div>
          </div>
          <div className="ld-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <section className="ld-card" aria-label="Pre-join check">
              <div className="ld-hd"><b>Pre-join check</b><button type="button" className="ld-btn2 sm" disabled={check === 'running'} onClick={runCheck}>{check === 'running' ? 'Checking…' : check ? 'Check again' : 'Run check'}</button></div>
              <div className="cd-chk"><span>Camera permission</span>{okText(done && check.camera)}</div>
              <div className="cd-chk"><span>Microphone</span>{okText(done && check.microphone)}</div>
              <div className="cd-chk"><span>Speaker test</span>{okText(done && check.speaker)}</div>
              <div className="cd-chk"><span>Browser{done ? ` (${check.browser})` : ''}</span>{done ? okText(/Chrome|Edge/.test(check.browser), 'Supported', 'Use Chrome') : <span className="ld-muted">—</span>}</div>
            </section>
            <section className="ld-card" aria-label="Join">
              <div className="ld-hd"><b>Join</b></div>
              {row.canJoin ? (
                <>
                  <div className="ld-muted" style={{ fontSize: 13 }}>{deviceCheckRequired ? 'Pehle camera / mic check chalega. ' : ''}One-time secure ticket · link kabhi page par nahi dikhta. Error aaye to support ticket banayein.</div>
                  <button type="button" className="ld-btn" disabled={joining} onClick={() => onJoin(row)}>{joining ? 'Joining…' : 'Join class'}</button>
                </>
              ) : row.status === 'RECORDING_AVAILABLE' ? (
                <button type="button" className="ld-btn2" onClick={onOpenRecordings}>Watch recording</button>
              ) : (
                <div className="ld-muted" style={{ fontSize: 13 }}>{cancelled ? 'This class was cancelled.' : step >= 3 ? 'This class has finished.' : 'Project Manager class start karenge tab "Join class" yahin aayega.'}</div>
              )}
              <div className="ld-muted" style={{ fontSize: 12 }}>
                {att === undefined
                  ? 'Loading your attendance…'
                  : att && (att.attendedMin || att.joins)
                    ? `Your attendance: ${att.status || ''}${att.firstJoinAt ? ` · joined ${clock(att.firstJoinAt)}` : ''} · ${att.attendedMin} min${att.joins > 1 ? ` · ${att.joins - 1} reconnect merged` : ''}`
                    : step >= 2
                      ? 'No attendance recorded for you in this class yet.'
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
              <div><span className="ld-muted">Materials</span><br /><button type="button" className="ld-link" onClick={onOpenMaterial}>Study material</button></div>
              <div><span className="ld-muted">Recording</span><br />{row.recording && row.recording.enabled ? <><b style={{ color: '#b91c1c' }}>Recording ON</b> <span className="ld-muted">(notice shown before join)</span></> : <b>Not recorded</b>}</div>
              {row.description && <div><span className="ld-muted">About this class</span><br />{row.description}</div>}
            </div>
          )}
          {tab === 'chat' && <ClassChat id={row.id} />}
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
  );
}

export default function ClassDetailDrawer({ row, onClose, ...rest }) {
  const flush = React.useRef(null);
  const close = () => {
    if (flush.current) flush.current();
    onClose();
  };
  return (
    <Drawer open={!!row} onClose={close} width="min(1180px, 100vw)" title={null} destroyOnClose styles={{ body: { padding: 0 } }}>
      {row && <ClassBoard row={row} onClose={close} beforeClose={flush} onOpenMaterial={() => { close(); window.location.assign('/learn/material'); }} {...rest} />}
    </Drawer>
  );
}
