import React, { lazy, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { PMTabs, Legacy, Loading, useLoad, useTab, res, fmtDay, fmtTime, errText } from './shared';

const LiveClasses = lazy(() => import('../LiveClasses'));

// P2 — host board for one class: lifecycle bar, pre-class checklist (recording
// toggle, material, planned topic), host controls, live attendance and the
// "what was taught today" delivery record. The full Live Classes page (all
// classes, schedule, postpone, add learner…) stays on the "All classes" tab.

const OVER = ['ended', 'recording_processing', 'recording_available', 'cancelled'];
const st = (c) => String((c && (c.status || c.lifecycle)) || '').toLowerCase();
const stepOf = (s) => (s === 'live' ? 2 : s === 'ending' ? 3 : OVER.includes(s) ? 4 : ['upcoming', 'starting'].includes(s) ? 1 : 0);
const mmss = (from) => {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
const ATT_CHIP = { PRESENT: 'hai', LATE: 'adh', PARTIAL: 'adh', ABSENT: 'gray', EXCUSED: 'naya' };

function pickClass(list, wanted) {
  if (wanted) return wanted;
  const mine = (list || []).filter((c) => c.myRole !== 'student');
  const live = mine.find((c) => ['live', 'starting', 'ending'].includes(st(c)));
  if (live) return live.id;
  const next = mine.filter((c) => !OVER.includes(st(c)) && new Date(c.scheduledEnd || c.scheduledStart) > new Date()).sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))[0];
  return next ? next.id : null;
}

function HostBoard({ classId, onPickAll }) {
  const navigate = useNavigate();
  const [, tick] = useState(0);
  const [busy, setBusy] = useState('');
  const [topic, setTopic] = useState('');
  const [coverage, setCoverage] = useState('full');
  const [otherTopic, setOtherTopic] = useState('');
  const [recTitle, setRecTitle] = useState('');
  const [saved, setSaved] = useState(null);
  const { data, loading, error, reload } = useLoad(async () => {
    const [c, board] = await Promise.all([lmsApi.liveClass(classId), lmsApi.pmClass(classId).catch(() => null)]);
    const cls = res(c);
    const b = res(board) || {};
    let material = null;
    if (b.planned) {
      const mats = res(await lmsApi.materials().catch(() => null)) || [];
      material = mats.find((m) => m.curriculum && m.curriculum.label === b.planned.code && (!cls.courseTitle || m.courseTitle === cls.courseTitle)) || null;
    }
    return { cls, board: b, material };
  }, [classId]);

  const live = data && ['live', 'starting', 'ending'].includes(st(data.cls));
  useEffect(() => {
    if (!live) return undefined;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    const r = setInterval(() => reload(), 20000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [live, reload]);

  useEffect(() => {
    if (!data) return;
    const b = data.board;
    const rec = b.record;
    setTopic((rec && b.planned && b.planned.sessionId) || (b.planned && b.planned.sessionId) || '');
    setCoverage((rec && rec.coverage) || 'full');
    setOtherTopic((rec && rec.coverage === 'different' && rec.deliveredTopic) || '');
    setRecTitle((rec && rec.recordingTitle) || (b.planned ? `${b.planned.code} · ${b.planned.title} · ${fmtDay(data.cls.scheduledStart)}` : ''));
    setSaved(rec);
  }, [data]);

  const students = useMemo(() => ((data && data.cls.attendees) || []).filter((a) => a.role !== 'teacher'), [data]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} />;
  const { cls, board, material } = data;
  const s = st(cls);
  const step = stepOf(s);
  const over = OVER.includes(s);
  const recOn = board.recordingEnabled !== undefined ? board.recordingEnabled : !(cls.recording && cls.recording.enabled === false);
  const online = students.filter((a) => a.online);
  const steps = ['Scheduled', 'Open for join', live && cls.actualStart ? `LIVE · ${mmss(cls.actualStart)}` : 'Live', 'Grace / closing', 'Ended'];

  const act = async (key, fn, okMsg) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.success === false) throw new Error(r.message);
      if (okMsg) message.success(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      await reload();
      return r;
    } catch (e) {
      message.error(errText(e, 'Action failed.'));
      return null;
    } finally {
      setBusy('');
    }
  };
  const toggleRec = () => act('rec', () => lmsApi.pmRecording(cls.id, !recOn), (r) => (r && r.message) || 'Saved.');
  const start = () => act('start', () => lmsApi.liveClassStart(cls.id), 'Class started.');
  const join = async () => {
    const r = await act('join', () => lmsApi.liveClassJoin(cls.id));
    const url = r && res(r) && res(r).url;
    if (url) window.open(url, '_blank', 'noopener');
  };
  const end = () =>
    Modal.confirm({
      title: 'End class for all?',
      content: 'Sab learners room se bahar ho jayenge aur attendance close ho jayegi.',
      okText: 'End class',
      okButtonProps: { danger: true },
      onOk: () => act('end', () => lmsApi.liveClassEnd(cls.id), 'Class ended.'),
    });
  const copyLink = async () => {
    const link = `${window.location.origin}/learn/classes`;
    try {
      await navigator.clipboard.writeText(link);
      message.success('Learner link copied — same link for the whole batch.');
    } catch (e) {
      message.info(link);
    }
  };
  const saveDelivery = () =>
    act(
      'save',
      async () => {
        const r = await lmsApi.pmSaveDelivery({ liveClassId: cls.id, sessionId: topic, coverage, deliveredTopic: coverage === 'different' ? otherTopic : '', recordingTitle: recTitle });
        if (r && r.success !== false) setSaved({ coverage, by: 'you', at: new Date() });
        return r;
      },
      'Delivery record saved — curriculum tracker updated.'
    );
  const opts = board.options || [];

  return (
    <>
      <div className="ld-hd" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1>Host · {cls.title}</h1>
          <div className="ld-muted" style={{ fontSize: 14 }}>
            {cls.batchName} · {fmtDay(cls.scheduledStart)} {fmtTime(cls.scheduledStart)}–{fmtTime(cls.scheduledEnd)} · {cls.meetingProvider === 'bigbluebutton' ? 'BBB' : cls.meetingProvider || 'room'} room {cls.roomName ? String(cls.roomName).slice(-12) : ''} · same link for whole batch
          </div>
        </div>
        <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={onPickAll}>Another class →</button>
      </div>
      <div className="ld-steps">
        {steps.map((label, i) => (
          <div key={label} className={`ld-stp${i < step ? ' done' : ''}${i === step ? (i === 2 ? ' live' : ' on') : ''}`}>{label}</div>
        ))}
      </div>

      <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Pre-class checklist">
          <div className="ld-hd"><b>Pre-class checklist</b></div>
          <div className="ld-li">
            <span>Recording</span>
            <button type="button" className={`pm-tog${recOn ? ' on' : ''}`} aria-label="Toggle recording" aria-pressed={recOn} disabled={over || busy === 'rec'} onClick={toggleRec}><i /></button>
          </div>
          {!recOn && <div className="pm-alert">Recording OFF — is class ki recording recover nahi hogi. Support Manager ko alert gaya.</div>}
          <div className="ld-li"><span>Recording notice shown to learners</span><b style={{ color: recOn ? '#166534' : '#475569' }}>{recOn ? 'Yes' : 'No recording'}</b></div>
          <div className="ld-li">
            <span>Material attached</span>
            {material ? <a href={material.fileUrl} target="_blank" rel="noreferrer">{material.originalName || material.title}</a> : <button type="button" className="ld-link" onClick={() => navigate('/teacher/curriculum')}>None — upload →</button>}
          </div>
          <div className="ld-li"><span>Planned topic</span><b>{board.planned ? `${board.planned.code} · ${board.planned.title}` : '—'}</b></div>
          <div className="ld-hd" style={{ marginTop: 6 }}><b>Host controls</b></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {!over && !live && <button type="button" className="ld-btn" disabled={!cls.canStart || busy === 'start'} onClick={start}>Start class</button>}
            {live && <button type="button" className="ld-btn" disabled={busy === 'join'} onClick={join}>Join as host</button>}
            <button type="button" className="ld-btn2" onClick={copyLink}>Copy share link</button>
            <button type="button" className="ld-btn2" disabled title="Room ke andar BBB controls se">Mute all</button>
            <button type="button" className="ld-btn2" disabled title="Room ke andar BBB controls se">Make presenter</button>
          </div>
          <div className="ld-muted" style={{ fontSize: 12 }}>Mute / presenter / poll BBB room ke andar se hote hain.</div>
          <button type="button" className="ld-btn danger" style={{ marginTop: 'auto' }} disabled={!live || !cls.canEnd || busy === 'end'} onClick={end}>End class for all</button>
        </section>

        <section className="ld-card pm-scroll" aria-label="Attendance">
          <div className="ld-hd"><b>Waiting to join · 0</b><span className="ld-chip gray">LOBBY OFF</span></div>
          <div className="ld-muted" style={{ fontSize: 13 }}>Batch ke learners seedha join karte hain — waiting room band hai.</div>
          <div className="ld-hd" style={{ marginTop: 6 }}><b>In class · live attendance</b><span className="ld-muted" style={{ fontSize: 12 }}>{online.length} online · {students.length} joined{board.media ? ` · 📷 ${board.media.filter((m) => m.role !== 'MODERATOR' && m.video).length} cameras on` : ''}</span></div>
          {students.length === 0 && <div className="ld-empty">{over ? 'Is class mein koi learner join nahi hua.' : 'Abhi koi learner join nahi hua.'}</div>}
          {students.slice(0, 12).map((a) => {
            // FUNC-04: camera / mic as BBB reports it from the learner's side
            const m = board.media && a.online ? board.media.find((x) => (a.crmUser && x.userId === String(a.crmUser)) || x.name === a.name) : null;
            return (
              <div className="ld-li" key={a.crmUser || a.email || a.name}>
                <span>
                  <b>{a.name}</b>
                  <span className="ld-muted"> · {a.online ? 'online' : 'left'} · {a.totalDurationMin || 0} min{a.firstJoinAt ? ` · joined ${fmtTime(a.firstJoinAt)}` : ''}</span>
                  {m && <span className="ld-muted" title="BBB se live: learner ne camera / mic share kiya ya nahi"> · {m.video ? '📷 camera on' : '📷 camera off'} · {m.listenOnly ? '🎧 listen only' : m.voice ? '🎤 mic joined' : '🎤 no audio'}</span>}
                </span>
                <span className={`ld-chip ${ATT_CHIP[a.status] || 'gray'}`}>{a.status || '—'}</span>
              </div>
            );
          })}
          {board.media && <div className="ld-muted" style={{ fontSize: 12 }}>Camera "off" = learner ne share hi nahi kiya (unke browser permission / device). "On" par bhi na dikhe to BBB webcam list scroll karein.</div>}
          {students.length > 12 && (
            <div className="ld-li"><b>+ {students.length - 12} learners</b><span className="ld-muted">{students.reduce((n, a) => n + Math.max(0, (a.joinCount || 1) - 1), 0)} reconnects merged</span></div>
          )}
        </section>

        <section className="ld-card" aria-label="Delivery record">
          <div className="ld-hd"><b>What was taught today?</b>{saved && <span className="ld-chip hai">SAVED</span>}</div>
          <div className="ld-muted" style={{ fontSize: 13, lineHeight: '19px' }}>Planned aur actually padhaya topic alag store hote hain. Curriculum status calendar date se nahi, isse update hoga.</div>
          {!board.planned && <div className="ld-empty">Is batch ka curriculum track nahi mila.</div>}
          {board.planned && (
            <>
              <label className="ld-label">Delivered topic
                <select className="ld-inp" aria-label="Delivered topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {opts.map((o) => (
                    <option key={o.sessionId} value={o.sessionId}>{o.code} · {o.title}{board.planned && o.sessionId === board.planned.sessionId ? ' (as planned)' : o.status === 'DELIVERED' ? ' (revision)' : ''}</option>
                  ))}
                </select>
              </label>
              <label className="ld-label">Coverage
                <select className="ld-inp" aria-label="Coverage" value={coverage} onChange={(e) => setCoverage(e.target.value)}>
                  <option value="full">Fully covered</option>
                  <option value="partial">Partially covered — carry to next class</option>
                  <option value="different">Different topic…</option>
                </select>
              </label>
              {coverage === 'different' && (
                <label className="ld-label">What was taught instead
                  <input className="ld-inp" aria-label="Different topic" value={otherTopic} onChange={(e) => setOtherTopic(e.target.value)} placeholder="e.g. Prompt chaining (revision)" />
                </label>
              )}
              <label className="ld-label">Recording title (auto)
                <input className="ld-inp" aria-label="Recording title" value={recTitle} onChange={(e) => setRecTitle(e.target.value)} />
              </label>
              {saved && saved.by && <div className="ld-muted" style={{ fontSize: 12 }}>Last saved by {saved.by}</div>}
              <button type="button" className="ld-btn" style={{ marginTop: 'auto' }} disabled={busy === 'save' || !topic || (coverage === 'different' && !otherTopic.trim())} onClick={saveDelivery}>
                {busy === 'save' ? 'Saving…' : 'Save delivery record'}
              </button>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export default function PMClassHost() {
  const wanted = (() => {
    try {
      return new URLSearchParams(window.location.search).get('class');
    } catch (e) {
      return null;
    }
  })();
  const [tab, setTab] = useTab('host');
  const [classId, setClassId] = useState(wanted);
  const { data: list, loading } = useLoad(async () => {
    if (wanted) return [];
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 7 * 86400000);
    return res(await lmsApi.liveClassesRange(from.toISOString(), to.toISOString())) || [];
  }, []);
  useEffect(() => {
    if (!classId && list) setClassId(pickClass(list, null));
  }, [list, classId]);

  return (
    <div className="ld-page pm">
      <PMTabs tabs={[['host', 'Host board'], ['all', 'All classes']]} value={tab} onChange={setTab} />
      {tab === 'all' && <Legacy><LiveClasses /></Legacy>}
      {tab === 'host' && (loading && !classId ? <Loading /> : classId ? <HostBoard key={classId} classId={classId} onPickAll={() => setTab('all')} /> : (
        <section className="ld-card"><b>Aaj ya is hafte koi class nahi</b><div className="ld-muted" style={{ fontSize: 13 }}>Saari classes "All classes" tab mein hain.</div><button type="button" className="ld-btn2 sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTab('all')}>All classes</button></section>
      ))}
    </div>
  );
}

