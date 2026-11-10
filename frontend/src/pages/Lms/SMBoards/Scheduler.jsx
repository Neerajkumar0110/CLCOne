import React, { useMemo, useState } from 'react';
import { Alert, Modal, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res, errText } from './shared';
import DuplicateClassesAlert from '../components/DuplicateClassesAlert';

// S6 — batches & live-class scheduler: batch list | week calendar of the
// chosen batch + class-time change (calendar, reminders, rooms and learners
// follow) + rename | schedule a class (one date or Mon–Fri for N weeks,
// BigBlueButton, recording on/off). Existing endpoints: live-class create,
// batch rename, recording toggle; new: /admin/sm/batches/:id/time.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PROV = { BBB: 'BigBlueButton — live, recording + attendance events auto', Zoom: 'Zoom — licence / API decision pending (D-12), not connected', 'Google Meet': 'Google Meet — provider decision pending (D-12), not connected' };
const mondayOf = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const stCls = (s) => (['live', 'starting'].includes(s) ? 'live' : ['ended', 'recording_processing', 'recording_available'].includes(s) ? 'done' : s === 'cancelled' ? 'off' : 'next');

export default function SMScheduler() {
  const navigate = useNavigate();
  const [selId, setSelId] = useState('');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [time, setTime] = useState(null);
  const [rename, setRename] = useState(null);
  const [form, setForm] = useState({ title: '', teacher: '', date: ymd(new Date(Date.now() + 86400000)), start: '', end: '', repeat: '0', rec: true, provider: 'BBB' });
  const [busy, setBusy] = useState('');
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.smBatches()), []);
  const batches = (data && data.batches) || [];
  const b = batches.find((x) => x.id === selId) || batches.find((x) => x.status === 'Running') || batches[0];
  const cal = useLoad(async () => {
    const to = new Date(week.getTime() + 6 * 86400000);
    return res(await lmsApi.liveClassesRange(week.toISOString(), to.toISOString())) || [];
  }, [week]);
  const events = useMemo(() => ((cal.data || []).filter((c) => b && c.batchName === b.name)), [cal.data, b]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  if (!b) return <SMPage title="Batches & live-class scheduler"><section className="ld-card"><div className="ld-empty">No batch.</div></section></SMPage>;

  const hours = [...new Set(events.map((e) => new Date(e.scheduledStart).getHours()))].sort((x, y) => x - y);
  const rowsH = hours.length ? hours : [Number(String(b.classTime || '18').slice(0, 2))];
  const cell = (dayIdx, h) => events.filter((e) => {
    const d = new Date(e.scheduledStart);
    return (d.getDay() + 6) % 7 === dayIdx && d.getHours() === h;
  });
  const curTime = time || { classTime: b.classTime || '', endTime: b.endTime || '' };
  const curName = rename === null ? b.name : rename;

  const applyTime = () => {
    if (!curTime.classTime || !curTime.endTime || (curTime.classTime === b.classTime && curTime.endTime === b.endTime)) return message.warning('Pick a new time.');
    Modal.confirm({
      title: `Change ${b.name} to ${curTime.classTime}–${curTime.endTime}?`,
      content: `Future classes, calendar, reminders, BBB rooms and the learner view all update · ${b.learners} learners will be notified.`,
      okText: `Apply & notify ${b.learners} learners`,
      onOk: async () => {
        const r = await lmsApi.smBatchTime(b.id, curTime).catch((e) => ({ success: false, message: errText(e, 'Failed.') }));
        if (r && r.success === false) {
          message.error(r.message);
          throw new Error(r.message);
        }
        message.success(r.message || 'Time changed.');
        setTime(null);
        reload();
        cal.reload();
      },
    });
  };
  const saveName = async () => {
    if (!curName.trim() || curName === b.name) return;
    setBusy('rename');
    try {
      const r = await lmsApi.smBatchRename(b.id, curName.trim());
      if (r && r.success === false) throw new Error(r.message);
      message.success('Renamed — calendar, reports, learner view updated.');
      setRename(null);
      reload();
      cal.reload();
    } catch (e) {
      message.error(errText(e, 'Could not rename.'));
    } finally {
      setBusy('');
    }
  };
  const startT = form.start || b.classTime || '';
  const endT = form.end || b.endTime || '';
  const create = async () => {
    if (!form.title.trim() || !form.date || !startT || !endT) return message.warning('Fill in the topic, date and time.');
    if (endT <= startT) return message.warning('The end time must be after the start time.');
    const dates = [];
    const first = new Date(`${form.date}T00:00:00`);
    if (form.repeat === '0') dates.push(first);
    else {
      for (let i = 0; i < Number(form.repeat) * 7; i += 1) {
        const d = new Date(first.getTime() + i * 86400000);
        if (d.getDay() >= 1 && d.getDay() <= 5) dates.push(d);
      }
    }
    setBusy('create');
    let made = 0;
    try {
      for (const d of dates) {
        const day = ymd(d);
        // eslint-disable-next-line no-await-in-loop
        const r = await lmsApi.smCreateClass({ batchId: b.id, title: form.title.trim(), teacherName: form.teacher || undefined, scheduledStart: new Date(`${day}T${startT}:00`).toISOString(), scheduledEnd: new Date(`${day}T${endT}:00`).toISOString() });
        if (r && r.success === false) throw new Error(r.message);
        const id = res(r) && res(r).id;
        // eslint-disable-next-line no-await-in-loop
        if (!form.rec && id) await lmsApi.pmRecording(id, false);
        made += 1;
      }
      message.success(`${made} class${made > 1 ? 'es' : ''} created for ${b.name}.`);
      setForm({ ...form, title: '' });
      cal.reload();
    } catch (e) {
      message.error(`${made ? `${made} created, then: ` : ''}${errText(e, 'Could not create.')}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <SMPage title="Batches & live-class scheduler">
      <DuplicateClassesAlert load={lmsApi.smDuplicates} request={lmsApi.smDuplicateRequest} onChanged={cal.reload} />
      <div className="sm-g" style={{ display: 'grid', gridTemplateColumns: '250px minmax(0, 1fr) 360px', gap: 14, flex: 1, minHeight: 0 }}>
        <section className="ld-card pm-scroll" style={{ gap: 8 }} aria-label="Batches">
          <b style={{ fontSize: 14 }}>Batches · {batches.length}</b>
          {batches.map((x) => (
            <button key={x.id} type="button" className={`sm-b${x.id === b.id ? ' on' : ''}`} onClick={() => { setSelId(x.id); setTime(null); setRename(null); }}>
              <span><b>{x.name}</b><br /><span className="ld-muted">{x.classTime ? `${x.classTime}–${x.endTime}` : 'no time'} · {x.learners}{x.seats ? ` / ${x.seats}` : ''}</span></span>
              <span className={`ld-chip ${x.status === 'Running' ? 'hai' : x.status === 'Completed' ? 'gray' : 'naya'}`}>{x.status === 'Running' ? 'Active' : x.status || '—'}</span>
            </button>
          ))}
          <button type="button" className="ld-btn2" style={{ marginTop: 'auto' }} onClick={() => navigate('/lms/batches')}>+ New batch</button>
        </section>

        <section className="ld-card" aria-label="Week calendar">
          <div className="ld-hd">
            <b style={{ fontSize: 15 }}>Week of {week.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {b.name}</b>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="ld-btn2 xs" aria-label="Previous week" onClick={() => setWeek(new Date(week.getTime() - 7 * 86400000))}>‹</button>
              <button type="button" className="ld-btn2 xs" aria-label="Next week" onClick={() => setWeek(new Date(week.getTime() + 7 * 86400000))}>›</button>
              <span className="ld-muted" style={{ fontSize: 12 }}>IST</span>
            </span>
          </div>
          <div className="sm-cal">
            <div />
            {DAYS.map((d, i) => <div key={d} className="h">{d} {new Date(week.getTime() + i * 86400000).getDate()}</div>)}
            {rowsH.map((h) => (
              <React.Fragment key={h}>
                <div className="t">{h % 12 || 12} {h < 12 ? 'AM' : 'PM'}</div>
                {DAYS.map((d, i) => {
                  const c = cell(i, h);
                  return c.length ? (
                    <div key={d} className={`ev ${stCls(String(c[0].status || c[0].lifecycle).toLowerCase())}`} title={c[0].title}>{(c[0].title || '').replace(/^.*—\s*/, '')}{['live', 'starting'].includes(c[0].status) ? ' · LIVE' : ''}</div>
                  ) : <div key={d} className="slot" />;
                })}
              </React.Fragment>
            ))}
          </div>
          {events.length === 0 && <div className="ld-empty">No class this week for {b.name}.</div>}

          <div className="ld-hd" style={{ marginTop: 8 }}><b style={{ fontSize: 15 }}>Change class time · {b.name}</b></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="ld-inp" type="time" aria-label="New start" value={curTime.classTime} onChange={(e) => setTime({ ...curTime, classTime: e.target.value })} />
            <span>→</span>
            <input className="ld-inp" type="time" aria-label="New end" value={curTime.endTime} onChange={(e) => setTime({ ...curTime, endTime: e.target.value })} />
          </div>
          {time && (curTime.classTime !== b.classTime || curTime.endTime !== b.endTime) && (
            <div className="ld-warn">{b.classTime}–{b.endTime} → <b>{curTime.classTime}–{curTime.endTime}</b> · {b.learners} learners · calendar, reminders, BBB room and learner view all update together</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}><button type="button" className="ld-btn" disabled={!time} onClick={applyTime}>Apply &amp; notify {b.learners} learners</button></div>

          <div className="ld-hd" style={{ marginTop: 8 }}><b style={{ fontSize: 15 }}>Rename batch</b></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input className="ld-inp" aria-label="Batch name" value={curName} onChange={(e) => setRename(e.target.value)} />
            <button type="button" className="ld-btn2 sm" disabled={busy === 'rename' || !curName.trim() || curName === b.name} onClick={saveName}>Save — calendar, reports, learner view</button>
          </div>
        </section>

        <section className="ld-card pm-form" aria-label="Schedule a class">
          <div className="ld-hd"><b style={{ fontSize: 15 }}>Schedule a class</b></div>
          <label className="ld-label">Batch<select className="ld-inp" value={b.id} onChange={(e) => setSelId(e.target.value)}>{batches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="ld-label">Topic / session<input className="ld-inp" placeholder="S81 · Multi-agent systems" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="ld-label">Project Manager
            <select className="ld-inp" value={form.teacher} onChange={(e) => setForm({ ...form, teacher: e.target.value })}>
              <option value="">Batch trainer ({b.trainer || '—'})</option>
              {data.teachers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label className="ld-label">Date<input className="ld-inp" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
            <label className="ld-label">Start<input className="ld-inp" type="time" aria-label="Start time" value={startT} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
            <label className="ld-label">End<input className="ld-inp" type="time" aria-label="End time" value={endT} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          </div>
          <label className="ld-label">Repeat
            <select className="ld-inp" value={form.repeat} onChange={(e) => setForm({ ...form, repeat: e.target.value })}>
              <option value="0">Just this date</option>
              <option value="1">Mon–Fri · 1 week</option>
              <option value="2">Mon–Fri · 2 weeks</option>
              <option value="4">Mon–Fri · 4 weeks</option>
            </select>
          </label>
          <div className="sm-cap">Meeting provider</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.keys(PROV).map((p) => <button key={p} type="button" className={`ld-seg${form.provider === p ? ' on' : ''}`} onClick={() => setForm({ ...form, provider: p })}>{p}</button>)}
          </div>
          <div className="ld-muted" style={{ fontSize: 12 }}>{PROV[form.provider]}</div>
          <label className="pm-check"><input type="checkbox" checked={form.rec} onChange={(e) => setForm({ ...form, rec: e.target.checked })} /> Recording ON (default)</label>
          <label className="pm-check"><input type="checkbox" checked disabled /> Join window opens early (live settings)</label>
          <label className="pm-check"><input type="checkbox" checked disabled /> Notify only this batch</label>
          <button type="button" className="ld-btn" style={{ marginTop: 'auto' }} disabled={busy === 'create' || form.provider !== 'BBB'} onClick={create}>{busy === 'create' ? 'Creating…' : 'Create & add to calendar'}</button>
        </section>
      </div>
    </SMPage>
  );
}
