import React, { useMemo, useState } from 'react';
import { Alert, Modal, message, Button, Input, Select, Switch, Tooltip } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  CalendarOutlined, PlusOutlined, ClockCircleOutlined, EditOutlined, TeamOutlined, UserOutlined, LeftOutlined, RightOutlined,
  VideoCameraOutlined, CheckCircleOutlined, FieldTimeOutlined, AppstoreAddOutlined, PlayCircleOutlined, StopOutlined, BellOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, Loading, res, errText } from './shared';
import DuplicateClassesAlert from '../components/DuplicateClassesAlert';
import '../AdminOps/mgmt.css';
import '../AdminOps/opsPages.css';
import './smDesign.css';
import './scheduler.css';

// S6 — batches & live-class scheduler: batch list | week calendar of the
// chosen batch + class-time change (calendar, reminders, rooms and learners
// follow) + rename | schedule a class (one date or Mon–Fri for N weeks,
// BigBlueButton, recording on/off). Existing endpoints: live-class create,
// batch rename, recording toggle; new: /admin/sm/batches/:id/time.
// 2026-11-27 redesign: gradient hero, batch cards, week calendar card;
// schedule / change time / rename / class details open in modals.

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
const ST_LABEL = { live: 'Live now', done: 'Held', off: 'Cancelled', next: 'Upcoming' };
const hm = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

export default function SMScheduler() {
  const navigate = useNavigate();
  const [selId, setSelId] = useState('');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [time, setTime] = useState(null);
  const [rename, setRename] = useState(null);
  const [modal, setModal] = useState(''); // 'schedule' | 'time' | 'rename' | ''
  const [ev, setEv] = useState(null);
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
  if (!b) return <div className="mg op"><div className="mg-card"><div className="mg-empty">No batch yet.</div></div></div>;

  const hours = [...new Set(events.map((e) => new Date(e.scheduledStart).getHours()))].sort((x, y) => x - y);
  const rowsH = hours.length ? hours : [Number(String(b.classTime || '18').slice(0, 2))];
  const cell = (dayIdx, h) => events.filter((e) => {
    const d = new Date(e.scheduledStart);
    return (d.getDay() + 6) % 7 === dayIdx && d.getHours() === h;
  });
  const curTime = time || { classTime: b.classTime || '', endTime: b.endTime || '' };
  const curName = rename === null ? b.name : rename;
  const today = ymd(new Date());

  const applyTime = () => {
    if (!curTime.classTime || !curTime.endTime || (curTime.classTime === b.classTime && curTime.endTime === b.endTime)) return message.warning('Pick a new time.');
    Modal.confirm({
      title: `Change ${b.name} to ${curTime.classTime}–${curTime.endTime}?`,
      content: `Future classes, calendar, reminders, BBB rooms and the learner view all update · ${b.learners} learners will be notified.`,
      okText: `Apply & notify ${b.learners} learners`,
      centered: true,
      onOk: async () => {
        const r = await lmsApi.smBatchTime(b.id, curTime).catch((e) => ({ success: false, message: errText(e, 'Failed.') }));
        if (r && r.success === false) {
          message.error(r.message);
          throw new Error(r.message);
        }
        message.success(r.message || 'Time changed.');
        setTime(null);
        setModal('');
        reload();
        cal.reload();
      },
    });
    return null;
  };
  const saveName = async () => {
    if (!curName.trim() || curName === b.name) return;
    setBusy('rename');
    try {
      const r = await lmsApi.smBatchRename(b.id, curName.trim());
      if (r && r.success === false) throw new Error(r.message);
      message.success('Renamed — calendar, reports, learner view updated.');
      setRename(null);
      setModal('');
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
      setModal('');
      cal.reload();
    } catch (e) {
      message.error(`${made ? `${made} created, then: ` : ''}${errText(e, 'Could not create.')}`);
    } finally {
      setBusy('');
    }
    return null;
  };
  const pick = (x) => { setSelId(x.id); setTime(null); setRename(null); };
  const running = batches.filter((x) => x.status === 'Running').length;

  return (
    <div className="mg op sch">
      <div className="mg-hero sch-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><CalendarOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Batches &amp; live-class scheduler</span>
            <h1>Plan every batch&apos;s classes</h1>
            <p>Pick a batch to see its week. Schedule classes (one date or Mon–Fri for weeks), change the class time for everyone at once, or rename the batch.</p>
          </div>
        </div>
        <div className="op-hero-r">
          <div className="rp-hero-stats"><span><b>{running}/{batches.length}</b><small>batches running</small></span></div>
          <Button type="primary" icon={<PlusOutlined />} className="sch-cta" onClick={() => setModal('schedule')}>Schedule a class</Button>
        </div>
      </div>

      <DuplicateClassesAlert load={lmsApi.smDuplicates} request={lmsApi.smDuplicateRequest} onChanged={cal.reload} />

      <div className="sch-grid">
        <section className="mg-card sch-batches" aria-label="Batches">
          <div className="mg-hd">
            <span className="mg-hd-ic g1"><TeamOutlined /></span>
            <div><b>Batches · {batches.length}</b><small>Pick one to see its week</small></div>
          </div>
          <div className="mg-card-body" style={{ gap: 8 }}>
            {batches.map((x) => (
              <button key={x.id} type="button" className={`sch-b${x.id === b.id ? ' on' : ''}`} onClick={() => pick(x)}>
                <span className="sch-b-ic">{String(x.name).slice(0, 2)}</span>
                <span className="sch-b-t">
                  <b>{x.name}</b>
                  <small><ClockCircleOutlined /> {x.classTime ? `${x.classTime}–${x.endTime}` : 'no time'} · <TeamOutlined /> {x.learners}{x.seats ? `/${x.seats}` : ''}</small>
                </span>
                <span className={`sch-dot ${x.status === 'Running' ? 'ok' : x.status === 'Completed' ? 'off' : 'info'}`} title={x.status || '—'} />
              </button>
            ))}
          </div>
          <div className="mg-foot"><Button block icon={<AppstoreAddOutlined />} onClick={() => navigate('/lms/batches')}>New batch</Button></div>
        </section>

        <div className="sch-main">
          <section className="sch-info">
            <span className="sch-info-ic">{String(b.name).slice(0, 2)}</span>
            <div className="sch-info-t">
              <b>{b.name}</b>
              <span className="op-chips">
                <span className={`mg-pill ${b.status === 'Running' ? 'ok' : b.status === 'Completed' ? 'none' : 'mid'}`}>{b.status === 'Running' ? 'Active' : b.status || '—'}</span>
                <span className="sch-chip"><ClockCircleOutlined /> {b.classTime ? `${b.classTime}–${b.endTime}` : 'no time set'} IST</span>
                <span className="sch-chip"><TeamOutlined /> {b.learners}{b.seats ? ` / ${b.seats}` : ''} learners</span>
                {b.trainer && <span className="sch-chip"><UserOutlined /> {b.trainer}</span>}
              </span>
            </div>
            <div className="op-chips">
              <Button icon={<FieldTimeOutlined />} onClick={() => setModal('time')}>Change time</Button>
              <Button icon={<EditOutlined />} onClick={() => setModal('rename')}>Rename</Button>
              <Button type="primary" icon={<PlusOutlined />} className="sch-cta" onClick={() => setModal('schedule')}>Schedule</Button>
            </div>
          </section>

          <section className="mg-card sch-cal-card" aria-label="Week calendar">
            <div className="mg-hd">
              <span className="mg-hd-ic g3"><CalendarOutlined /></span>
              <div><b>Week of {week.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</b><small>{events.length} class{events.length === 1 ? '' : 'es'} this week · click a class for details · IST</small></div>
              <span className="sch-nav">
                <Button size="small" icon={<LeftOutlined />} aria-label="Previous week" onClick={() => setWeek(new Date(week.getTime() - 7 * 86400000))} />
                <Button size="small" onClick={() => setWeek(mondayOf(new Date()))}>This week</Button>
                <Button size="small" icon={<RightOutlined />} aria-label="Next week" onClick={() => setWeek(new Date(week.getTime() + 7 * 86400000))} />
              </span>
            </div>
            <div className="sch-cal">
              <div className="sch-cal-c" />
              {DAYS.map((d, i) => {
                const day = new Date(week.getTime() + i * 86400000);
                return <div key={d} className={`sch-cal-h${ymd(day) === today ? ' today' : ''}`}><small>{d}</small><b>{day.getDate()}</b></div>;
              })}
              {rowsH.map((h) => (
                <React.Fragment key={h}>
                  <div className="sch-cal-t">{h % 12 || 12} {h < 12 ? 'AM' : 'PM'}</div>
                  {DAYS.map((d, i) => {
                    const c = cell(i, h);
                    if (!c.length) return <div key={d} className="sch-slot" />;
                    const st = stCls(String(c[0].status || c[0].lifecycle).toLowerCase());
                    return (
                      <button key={d} type="button" className={`sch-ev ${st}`} onClick={() => setEv(c[0])} title={c[0].title}>
                        <small>{st === 'live' ? <><i className="sch-live" /> LIVE</> : hm(c[0].scheduledStart)}</small>
                        <b>{(c[0].title || '').replace(/^.*—\s*/, '')}</b>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
            {events.length === 0 && <div className="sch-none"><CalendarOutlined /> No class this week for {b.name} — <button type="button" onClick={() => setModal('schedule')}>schedule one</button></div>}
            <div className="mg-foot sch-legend">
              <span><i className="next" /> Upcoming</span><span><i className="live" /> Live</span><span><i className="done" /> Held</span><span><i className="off" /> Cancelled</span>
            </div>
          </section>
        </div>
      </div>

      {/* schedule a class */}
      <Modal open={modal === 'schedule'} onCancel={() => setModal('')} footer={null} width={620} centered destroyOnClose rootClassName="mg-modal">
        <div className="mg-m">
          <div className="mg-m-head sch-m-head"><span className="mg-act">New class</span><h3><PlusOutlined /> Schedule a class</h3><span>Adds to the calendar and notifies only this batch</span></div>
          <div className="mg-m-body sch-form">
            <label className="ao-label">Batch<Select value={b.id} onChange={(v) => setSelId(v)} options={batches.map((x) => ({ value: x.id, label: x.name }))} /></label>
            <label className="ao-label">Topic / session<Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="S81 · Multi-agent systems" /></label>
            <label className="ao-label">Project Manager<Select value={form.teacher} onChange={(v) => setForm({ ...form, teacher: v })} options={[{ value: '', label: `Batch trainer (${b.trainer || '—'})` }, ...data.teachers.map((t) => ({ value: t, label: t }))]} /></label>
            <div className="sch-3">
              <label className="ao-label">Date<input className="mg-date sch-in" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
              <label className="ao-label">Start<input className="mg-date sch-in" type="time" value={startT} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
              <label className="ao-label">End<input className="mg-date sch-in" type="time" value={endT} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
            </div>
            <label className="ao-label">Repeat<Select value={form.repeat} onChange={(v) => setForm({ ...form, repeat: v })} options={[{ value: '0', label: 'Just this date' }, { value: '1', label: 'Mon–Fri · 1 week' }, { value: '2', label: 'Mon–Fri · 2 weeks' }, { value: '4', label: 'Mon–Fri · 4 weeks' }]} /></label>
            <div className="mg-m-cap">Meeting provider</div>
            <div className="sch-prov">
              {Object.keys(PROV).map((p) => <button key={p} type="button" className={`sch-prov-b${form.provider === p ? ' on' : ''}${p !== 'BBB' ? ' na' : ''}`} onClick={() => setForm({ ...form, provider: p })}><VideoCameraOutlined /> {p}</button>)}
            </div>
            <small className="mg-rsn">{PROV[form.provider]}</small>
            <div className="sch-opts">
              <span><Switch size="small" checked={form.rec} onChange={(v) => setForm({ ...form, rec: v })} /> Recording {form.rec ? 'ON' : 'OFF'}</span>
              <span className="fixed"><CheckCircleOutlined /> Join window opens early</span>
              <span className="fixed"><BellOutlined /> Notify only this batch</span>
            </div>
          </div>
          <div className="mg-m-foot" style={{ gap: 8 }}>
            <Button onClick={() => setModal('')}>Cancel</Button>
            <Button type="primary" icon={<CalendarOutlined />} loading={busy === 'create'} disabled={form.provider !== 'BBB'} onClick={create}>Create &amp; add to calendar</Button>
          </div>
        </div>
      </Modal>

      {/* change time */}
      <Modal open={modal === 'time'} onCancel={() => { setModal(''); setTime(null); }} footer={null} width={520} centered destroyOnClose rootClassName="mg-modal">
        <div className="mg-m">
          <div className="mg-m-head sch-m-head"><span className="mg-act">{b.name}</span><h3><FieldTimeOutlined /> Change class time</h3><span>Calendar, reminders, BBB room and learner view all update together</span></div>
          <div className="mg-m-body">
            <div className="smx-oldnew">
              <div><small>Now</small><b>{b.classTime || '—'}–{b.endTime || '—'}</b></div>
              <span className="smx-arrow">→</span>
              <div><small>New time</small><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input className="mg-date sch-in" type="time" value={curTime.classTime} onChange={(e) => setTime({ ...curTime, classTime: e.target.value })} />–<input className="mg-date sch-in" type="time" value={curTime.endTime} onChange={(e) => setTime({ ...curTime, endTime: e.target.value })} /></span></div>
            </div>
            <div className="smx-checks"><span className="info"><BellOutlined /> {b.learners} learners will be notified of the new time</span></div>
          </div>
          <div className="mg-m-foot" style={{ gap: 8 }}>
            <Button onClick={() => { setModal(''); setTime(null); }}>Cancel</Button>
            <Button type="primary" disabled={!time} onClick={applyTime}>Apply &amp; notify {b.learners} learners</Button>
          </div>
        </div>
      </Modal>

      {/* rename */}
      <Modal open={modal === 'rename'} onCancel={() => { setModal(''); setRename(null); }} footer={null} width={480} centered destroyOnClose rootClassName="mg-modal">
        <div className="mg-m">
          <div className="mg-m-head sch-m-head"><span className="mg-act">{b.name}</span><h3><EditOutlined /> Rename batch</h3><span>The new name shows in the calendar, reports and the learner view</span></div>
          <div className="mg-m-body"><label className="ao-label">Batch name<Input value={curName} onChange={(e) => setRename(e.target.value)} /></label></div>
          <div className="mg-m-foot" style={{ gap: 8 }}>
            <Button onClick={() => { setModal(''); setRename(null); }}>Cancel</Button>
            <Button type="primary" loading={busy === 'rename'} disabled={!curName.trim() || curName === b.name} onClick={saveName}>Save name</Button>
          </div>
        </div>
      </Modal>

      {/* class details */}
      <Modal open={!!ev} onCancel={() => setEv(null)} footer={null} width={480} centered destroyOnClose rootClassName="mg-modal">
        {ev && (() => {
          const st = stCls(String(ev.status || ev.lifecycle).toLowerCase());
          const StIc = st === 'live' ? PlayCircleOutlined : st === 'done' ? CheckCircleOutlined : st === 'off' ? StopOutlined : ClockCircleOutlined;
          return (
            <div className="mg-m">
              <div className={`mg-m-head sch-m-head ${st}`}><span className="mg-act"><StIc /> {ST_LABEL[st]}</span><h3>{(ev.title || '').replace(/^.*—\s*/, '')}</h3><span>{b.name}</span></div>
              <div className="mg-m-body">
                <div className="lrx-kv">
                  <div><small>Date</small><b>{new Date(ev.scheduledStart).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b></div>
                  <div><small>Time</small><b>{hm(ev.scheduledStart)}{ev.scheduledEnd ? `–${hm(ev.scheduledEnd)}` : ''}</b></div>
                  {ev.teacherName && <div><small>Project Manager</small><b>{ev.teacherName}</b></div>}
                </div>
                <div className="mg-m-cap">Full title</div>
                <div className="mg-m-box">{ev.title}</div>
              </div>
              <div className="mg-m-foot"><Tooltip title="Close"><Button type="primary" onClick={() => setEv(null)}>Close</Button></Tooltip></div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
