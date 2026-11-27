import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Segmented, Select, Progress, DatePicker, Button, Skeleton, Input, Tooltip } from 'antd';
import {
  ScheduleOutlined, ClockCircleOutlined, CalendarOutlined, ArrowLeftOutlined, ArrowRightOutlined, SearchOutlined, ReloadOutlined,
  CheckCircleOutlined, CheckOutlined, StepForwardOutlined, UndoOutlined, DownOutlined, UserOutlined, TeamOutlined, WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES, LMS_FULL_ACCESS_ROLES } from '@/config/roles';
import lmsApi from '@/pages/Lms/api';
import '../Policies/policyDesign.css';
import './cur.css';
import { LearnerListControls, useLearnerList } from '../components/LearnerListControls';

// Wired to GET /api/lms/assessments/admin/curriculum/sessions?batch&track and
// PATCH .../admin/curriculum/sessions/:id/delivery (ported from the
// python-test-platform reference project). `batch` is matched against this
// CRM's real Batch.name (via teacherDashboard's own batch list, same source
// Assignments/Projects/Announcements use) — it used to be 3 hardcoded fake
// time-slot strings with no relation to any real batch at all. Which track
// (FOUNDATION/ELITE) applies is resolved server-side from the batch's own
// course length (services/lms/curriculumTracker.js), and delivery now
// auto-advances one unit per completed live class instead of only being
// set by hand.
const TRACKS = [
  { value: 'FOUNDATION', label: 'Foundation (6-Month)' },
  { value: 'ELITE', label: 'Elite (12-Month)' },
];
const STATUS_CHIP = { DELIVERED: ['green', 'Delivered'], SKIPPED: ['amber', 'Skipped'], PENDING: ['', 'Pending'] };

function isBehindSchedule(s) {
  if (s.status !== 'PENDING' || !s.plannedDate) return false;
  return new Date(s.plannedDate) < new Date();
}
function groupByUnit(sessions) {
  const groups = {};
  for (const s of sessions) {
    if (!groups[s.unit]) groups[s.unit] = [];
    groups[s.unit].push(s);
  }
  return groups;
}
// Colour the number, not just the bar: in a list of many batches an admin is
// looking for the one that has stalled, not reading every row.
const pctTone = (p) => (p >= 75 ? '#16a34a' : p >= 40 ? '#d97706' : '#dc2626');
const pctKey = (p) => (p >= 75 ? 'ok' : p >= 40 ? 'mid' : 'bad');
const RING_GRAD = { ok: { '0%': '#2dd4bf', '100%': '#16a34a' }, mid: { '0%': '#fbbf24', '100%': '#ea580c' }, bad: { '0%': '#fb7185', '100%': '#dc2626' } };

function sessionStats(sessions) {
  const delivered = sessions.filter((s) => s.status === 'DELIVERED').length;
  const skipped = sessions.filter((s) => s.status === 'SKIPPED').length;
  const behind = sessions.filter(isBehindSchedule).length;
  const total = sessions.length;
  return { delivered, skipped, behind, total, pending: total - delivered - skipped, percent: total ? Math.round((delivered / total) * 100) : 0 };
}

// 2026-11-27 redesign: one header card for a batch (ring + counts), shared by
// the teacher, admin drill-in and learner views.
function BatchHeader({ title, sub, percent, stats, right, children }) {
  return (
    <section className={`cur-head ${pctKey(percent)}`}>
      <div className="cur-head-main">
        <div className="cur-ring-wrap">
          <Progress type="circle" size={92} strokeWidth={9} percent={percent} strokeColor={RING_GRAD[pctKey(percent)]} trailColor="rgba(255,255,255,.55)" format={() => <span className="cur-ring"><b>{percent}%</b><small>done</small></span>} />
        </div>
        <div className="cur-head-t">
          <h2>{title}</h2>
          {sub && <div className="cur-head-sub">{sub}</div>}
          {stats && (
            <div className="cur-head-stats">
              <span className="cur-hs ok"><b>{stats.delivered}</b> delivered</span>
              <span className="cur-hs"><b>{stats.pending}</b> pending</span>
              {stats.skipped > 0 && <span className="cur-hs mid"><b>{stats.skipped}</b> skipped</span>}
              {stats.behind > 0 && <span className="cur-hs bad"><b>{stats.behind}</b> behind schedule</span>}
              <span className="cur-hs"><b>{stats.total}</b> sessions in all</span>
            </div>
          )}
        </div>
        {right && <div className="cur-head-r">{right}</div>}
      </div>
      {children}
    </section>
  );
}

// Shared session list — `onUpdate` present (teacher/admin) shows the date
// picker + action buttons; omitted (student) renders a plain read-only view.
function SessionsList({ sessions, loading, onUpdate }) {
  const grouped = groupByUnit(sessions);
  // the ongoing topic = the first one not delivered yet, in syllabus order (report #18)
  const currentId = ((sessions || []).find((x) => x.status === 'PENDING') || {}).sessionId || null;
  const units = Object.entries(grouped);
  // finished units start folded, the rest open
  const [closed, setClosed] = useState(null);
  const isClosed = (u, list) => (closed && u in closed ? closed[u] : list.every((s) => s.status !== 'PENDING'));
  const toggle = (u, list) => setClosed((c) => ({ ...(c || {}), [u]: !isClosed(u, list) }));
  const editable = typeof onUpdate === 'function';

  if (loading && sessions.length === 0) return <Skeleton active paragraph={{ rows: 6 }} />;
  if (!loading && sessions.length === 0) {
    return <div className="pol-empty"><span className="pol-empty-ic"><ScheduleOutlined /></span><b>No sessions for this batch yet</b><span>The curriculum hasn&apos;t been mapped for this track.</span></div>;
  }

  return (
    <div className="cur-units">
      <div className="cur-unit-strip" aria-label="Units">
        {units.map(([unit, list], i) => {
          const st = sessionStats(list);
          return (
            <a key={unit} href={`#cur-u-${i}`} className={`cur-us ${st.percent === 100 ? 'done' : st.delivered ? 'on' : ''}`} title={unit}>
              <small>Unit {i + 1}</small>
              <b>{st.delivered}/{st.total}</b>
              <i><span style={{ width: `${st.percent}%` }} /></i>
            </a>
          );
        })}
      </div>

      {units.map(([unit, list], i) => {
        const st = sessionStats(list);
        const shut = isClosed(unit, list);
        return (
          <section key={unit} id={`cur-u-${i}`} className={`cur-unit${st.percent === 100 ? ' done' : ''}`}>
            <button type="button" className="cur-unit-hd" onClick={() => toggle(unit, list)} aria-expanded={!shut}>
              <span className="cur-unit-n">{st.percent === 100 ? <CheckCircleOutlined /> : i + 1}</span>
              <span className="cur-unit-t">
                <b>{unit}</b>
                <small>{st.delivered}/{st.total} delivered{st.skipped ? ` · ${st.skipped} skipped` : ''}{st.behind ? ` · ${st.behind} behind` : ''} · {list.reduce((n, s) => n + (Number(s.hours) || 0), 0)}h</small>
              </span>
              <span className="cur-unit-bar"><span style={{ width: `${st.percent}%`, background: pctTone(st.percent) }} /></span>
              <span className="cur-unit-pct" style={{ color: pctTone(st.percent) }}>{st.percent}%</span>
              <DownOutlined className={`cur-caret${shut ? '' : ' open'}`} />
            </button>
            {!shut && (
              <div className={`cur-rows${editable ? ' edit' : ''}`}>
                <div className="cur-row cur-row-h">
                  <span>Code</span><span>Session</span><span>Hours</span><span>Status</span>
                  {editable && <span>Planned</span>}
                  <span>Delivered on</span>
                  {editable && <span />}
                </div>
                {list.map((s) => {
                  const cur = s.sessionId === currentId;
                  const behind = isBehindSchedule(s);
                  const [tone, label] = STATUS_CHIP[s.status] || STATUS_CHIP.PENDING;
                  return (
                    <div key={s.sessionId} className={`cur-row${cur ? ' cur' : ''}${behind ? ' behind' : ''}${s.status === 'DELIVERED' ? ' dlv' : ''}`}>
                      <span className="cur-code">{s.code}</span>
                      <span className="cur-title"><b>{s.title}</b>{s.notes && <small>{s.notes}</small>}</span>
                      <span className="cur-hrs">{s.hours}h</span>
                      <span className="cur-st">
                        <span className={`pol-chip ${tone}`}>{label}</span>
                        {cur && <span className="pol-chip blue">Current</span>}
                        {behind && <span className="pol-chip red">Behind</span>}
                      </span>
                      {editable && (
                        <span>
                          <DatePicker size="small" placeholder="Set date" format="D MMM" value={s.plannedDate ? dayjs(s.plannedDate) : null} onChange={(d) => onUpdate(s.sessionId, { plannedDate: d ? d.format('YYYY-MM-DD') : null })} style={{ width: 118 }} />
                        </span>
                      )}
                      <span className="cur-date">{s.actualDate ? dayjs(s.actualDate).format('D MMM YYYY') : '—'}</span>
                      {editable && (
                        <span className="cur-act">
                          {s.status !== 'DELIVERED' && (
                            <Tooltip title="Mark delivered today"><Button size="small" type="primary" ghost icon={<CheckOutlined />} onClick={() => onUpdate(s.sessionId, { status: 'DELIVERED', actualDate: dayjs().format('YYYY-MM-DD') })} /></Tooltip>
                          )}
                          {s.status !== 'SKIPPED' && (
                            <Tooltip title="Skip this session"><Button size="small" icon={<StepForwardOutlined />} onClick={() => onUpdate(s.sessionId, { status: 'SKIPPED' })} /></Tooltip>
                          )}
                          {s.status !== 'PENDING' && (
                            <Tooltip title="Reset to pending"><Button size="small" icon={<UndoOutlined />} onClick={() => onUpdate(s.sessionId, { status: 'PENDING', actualDate: null })} /></Tooltip>
                          )}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ═══════════ TEACHER — pick a batch, mark delivery ═══════════ */
function TeacherCurriculum() {
  const [track, setTrack] = useState('FOUNDATION');
  const [batches, setBatches] = useState([]); // real Batch rows: { name, classDays, classTime, endTime, ... }
  const [batch, setBatch] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [batchesLoading, setBatchesLoading] = useState(true);

  useEffect(() => {
    lmsApi.teacherDashboard().then((d) => {
      const rows = (d && d.result && d.result.batches) || [];
      setBatches(rows);
      if (rows.length) setBatch(rows[0].name);
    }).finally(() => setBatchesLoading(false));
  }, []);

  // Guards the auto track-correction below to once per batch selection — a
  // teacher's own manual Segmented click afterward is never overridden.
  const autoTrackBatchRef = useRef(null);

  const load = useCallback(async () => {
    if (!batch) { setSessions([]); setLoading(false); return; }
    setLoading(true);
    const res = await lmsApi.assessmentCurriculumSessions({ batch, track });
    const data = (res && res.result) || {};
    // The backend resolves which track (FOUNDATION/ELITE) actually matches
    // this batch's own course length — auto-switch to it the first time
    // this batch is opened, instead of silently showing 0% against the
    // wrong track.
    if (data.resolvedTrack && data.resolvedTrack !== track && autoTrackBatchRef.current !== batch) {
      autoTrackBatchRef.current = batch;
      setTrack(data.resolvedTrack);
      return;
    }
    autoTrackBatchRef.current = batch;
    setSessions(data.sessions || []);
    setLoading(false);
  }, [batch, track]);

  useEffect(() => { load(); }, [load]);

  const activeBatch = batches.find((b) => b.name === batch);
  const stats = useMemo(() => sessionStats(sessions), [sessions]);

  const updateDelivery = async (sessionId, patch) => {
    await lmsApi.updateAssessmentDelivery(sessionId, { batch, ...patch });
    load();
  };

  if (batchesLoading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="pol cur" style={{ padding: 4 }}>
      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic"><ScheduleOutlined /></span>
          <div>
            <h2>Curriculum Delivery Tracker</h2>
            <p>Which sessions your batch has actually covered against the plan. Each completed live class moves it on automatically — fix anything here by hand.</p>
          </div>
        </div>
        {batches.length > 0 && (
          <div className="cur-pick">
            <Select value={batch} onChange={setBatch} style={{ minWidth: 220 }} options={batches.map((b) => ({ value: b.name, label: b.name }))} placeholder="Select a batch…" />
            <Segmented value={track} onChange={setTrack} options={TRACKS.map((t) => ({ value: t.value, label: t.label }))} />
          </div>
        )}
      </div>

      {batches.length === 0 ? (
        <div className="pol-empty"><span className="pol-empty-ic"><ScheduleOutlined /></span><b>No batches assigned yet</b></div>
      ) : (
        <>
          <BatchHeader
            title={batch}
            percent={stats.percent}
            stats={stats}
            sub={activeBatch && (
              <>
                <span><CalendarOutlined /> {activeBatch.classDays || 'Days not set'}</span>
                <span><ClockCircleOutlined /> {activeBatch.classTime && activeBatch.endTime ? `${activeBatch.classTime} – ${activeBatch.endTime}` : 'Time not set'}</span>
                {activeBatch.course && <span>{activeBatch.course}</span>}
                <span>{TRACKS.find((t) => t.value === track)?.label}</span>
              </>
            )}
          />
          <SessionsList sessions={sessions} loading={loading} onUpdate={updateDelivery} />
        </>
      )}
    </div>
  );
}

/* ═══════════ ADMIN — every batch, filter + drill in ═══════════ */
function AdminCurriculum() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [course, setCourse] = useState('');
  const [trainer, setTrainer] = useState('');
  const [band, setBand] = useState('all');
  const [sort, setSort] = useState('pct-asc');

  // drill-in: the batch whose session-by-session detail is open
  const [drill, setDrill] = useState(null); // batch row | null
  const [track, setTrack] = useState('FOUNDATION');
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  // follow the batch's own track only when a batch is first opened — a
  // Foundation/Elite pick by the user stays (it reverted on every load, report #18)
  const drillTrackRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lmsApi.curriculumOverview();
      const r = (res && res.result) || {};
      // trainer may come as an array of names — show them comma-separated
      setRows((r.batches || []).map((b) => ({ ...b, trainer: Array.isArray(b.trainer) ? b.trainer.filter(Boolean).join(', ') : b.trainer })));
      setSummary(r.summary || null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadSessions = useCallback(async () => {
    if (!drill) return;
    setSessionsLoading(true);
    try {
      const res = await lmsApi.assessmentCurriculumSessions({ batch: drill.name, track });
      const data = (res && res.result) || {};
      setSessions(data.sessions || []);
      // Course length decides the track server-side — follow it rather than
      // showing 0% against the wrong one.
      if (data.resolvedTrack && data.resolvedTrack !== track && drillTrackRef.current !== drill.name) {
        drillTrackRef.current = drill.name;
        setTrack(data.resolvedTrack);
      }
      drillTrackRef.current = drill.name;
    } finally {
      setSessionsLoading(false);
    }
  }, [drill, track]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const courses = useMemo(() => [...new Set(rows.map((r) => r.course).filter(Boolean))].sort(), [rows]);
  const trainers = useMemo(() => [...new Set(rows.map((r) => r.trainer).filter(Boolean))].sort(), [rows]);
  const bandOf = (r) => (!r.tracked ? 'none' : pctKey(r.percent || 0));
  const bandN = rows.reduce((m, r) => ({ ...m, [bandOf(r)]: (m[bandOf(r)] || 0) + 1 }), {});

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!needle || `${r.name} ${r.course} ${r.trainer}`.toLowerCase().includes(needle)) &&
        (!course || r.course === course) &&
        (!trainer || r.trainer === trainer) &&
        (band === 'all' || bandOf(r) === band)
    );
    const by = {
      'pct-asc': (a, b) => (a.percent || 0) - (b.percent || 0),
      'pct-desc': (a, b) => (b.percent || 0) - (a.percent || 0),
      name: (a, b) => a.name.localeCompare(b.name),
      last: (a, b) => new Date(b.lastDeliveredAt || 0) - new Date(a.lastDeliveredAt || 0),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, course, trainer, band, sort]);

  const stats = useMemo(() => sessionStats(sessions), [sessions]);

  const updateDelivery = async (sessionId, patch) => {
    await lmsApi.updateAssessmentDelivery(sessionId, { batch: drill.name, ...patch });
    loadSessions();
    load(); // the overview percentage moves too
  };

  if (drill) {
    return (
      <div className="pol cur" style={{ padding: 4 }}>
        <div className="cur-bar">
          <Button icon={<ArrowLeftOutlined />} onClick={() => { setDrill(null); setSessions([]); }}>All batches</Button>
          <Segmented value={track} onChange={setTrack} options={TRACKS.map((t) => ({ value: t.value, label: t.label }))} />
        </div>
        <BatchHeader
          title={drill.name}
          percent={sessions.length ? stats.percent : drill.percent || 0}
          stats={sessions.length ? stats : null}
          sub={(
            <>
              <span>{drill.course || 'No internship'}</span>
              {drill.trainer && <span><UserOutlined /> {drill.trainer}</span>}
              <span><CalendarOutlined /> {drill.classesHeld} of {drill.classesTotal} classes held</span>
              {drill.tracked && <span>{drill.deliveredChapters}/{drill.totalChapters} topics · {drill.completedUnits}/{drill.totalUnits} units</span>}
            </>
          )}
        />
        <SessionsList sessions={sessions} loading={sessionsLoading} onUpdate={updateDelivery} />
      </div>
    );
  }

  return (
    <div className="pol cur" style={{ padding: 4 }}>
      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic"><ScheduleOutlined /></span>
          <div>
            <h2>Curriculum Delivery Tracker</h2>
            <p>Every batch and how far through its internship it is. Click a batch to see it session by session and correct delivery.</p>
          </div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </div>

      {summary && (
        <div className="pol-stats">
          <div className="pol-stat"><span className="pol-stat-ic violet"><TeamOutlined /></span><div><b>{summary.batches}</b><span>Batches</span></div></div>
          <div className="pol-stat"><span className="pol-stat-ic teal"><ScheduleOutlined /></span><div><b style={{ color: pctTone(summary.avgPercent) }}>{summary.avgPercent}%</b><span>Average completion</span></div></div>
          <div className="pol-stat"><span className="pol-stat-ic blue"><CalendarOutlined /></span><div><b>{summary.classesHeld}<small className="cur-of"> / {summary.classesTotal}</small></b><span>Classes held</span></div></div>
          <div className="pol-stat"><span className="pol-stat-ic amber"><WarningOutlined /></span><div><b>{bandN.bad || 0}</b><span>Behind (below 40%){summary.untrackedBatches ? ` · ${summary.untrackedBatches} not tracked` : ''}</span></div></div>
        </div>
      )}

      <div className="cur-tools">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search batch, internship or trainer" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <Select allowClear value={course || undefined} onChange={(v) => setCourse(v || '')} placeholder="All internships" style={{ minWidth: 200 }} options={courses.map((c) => ({ value: c, label: c }))} />
        <Select allowClear value={trainer || undefined} onChange={(v) => setTrainer(v || '')} placeholder="All trainers" style={{ minWidth: 160 }} options={trainers.map((t) => ({ value: t, label: t }))} />
        <Select value={sort} onChange={setSort} style={{ minWidth: 190 }} options={[{ value: 'pct-asc', label: 'Sort: least complete first' }, { value: 'pct-desc', label: 'Sort: most complete first' }, { value: 'name', label: 'Sort: batch name' }, { value: 'last', label: 'Sort: last delivered' }]} />
      </div>
      <div className="pol-pills">
        {[['all', 'All', rows.length], ['bad', 'Behind · below 40%', bandN.bad || 0], ['mid', 'In progress · 40–74%', bandN.mid || 0], ['ok', 'On track · 75%+', bandN.ok || 0], ...(bandN.none ? [['none', 'Not tracked', bandN.none]] : [])].map(([k, label, n]) => (
          <button key={k} type="button" className={`pol-pill${band === k ? ' on' : ''}`} onClick={() => setBand(k)}>{label} · {n}</button>
        ))}
      </div>

      {loading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : filtered.length === 0 ? (
        <div className="pol-empty"><span className="pol-empty-ic"><SearchOutlined /></span><b>{rows.length ? 'No batch matches these filters' : 'No batches yet'}</b></div>
      ) : (
        <div className="cur-grid">
          {filtered.map((r) => {
            const p = r.percent || 0;
            const heldPct = r.classesTotal ? Math.min(100, Math.round((r.classesHeld / r.classesTotal) * 100)) : 0;
            return (
              <article key={r.id || r.name} className={`cur-card ${r.tracked ? pctKey(p) : 'none'}`} role="button" tabIndex={0} onClick={() => setDrill(r)} onKeyDown={(e) => { if (e.key === 'Enter') setDrill(r); }}>
                <div className="cur-card-top">
                  <div style={{ minWidth: 0 }}>
                    <b className="cur-card-name">{r.name}</b>
                    <small className="cur-card-course">{r.course || 'No internship'}</small>
                  </div>
                  {r.tracked ? (
                    <Progress type="circle" size={58} percent={p} strokeColor={pctTone(p)} format={() => <b className="cur-card-pct" style={{ color: pctTone(p) }}>{p}%</b>} />
                  ) : (
                    <Tooltip title="This batch has no internship curriculum mapped, so there is nothing to measure against."><span className="pol-chip">Not tracked</span></Tooltip>
                  )}
                </div>
                <div className="cur-card-kv">
                  <span><UserOutlined /> {r.trainer || '—'}</span>
                  {r.tracked && <span>{r.deliveredChapters}/{r.totalChapters} topics · {r.completedUnits}/{r.totalUnits} units</span>}
                </div>
                <div className="cur-card-held">
                  <div><small>Classes held</small><b>{r.classesHeld}<span> / {r.classesTotal}</span></b></div>
                  <i><span style={{ width: `${heldPct}%` }} /></i>
                </div>
                <div className="cur-card-now">
                  <small>Currently on</small>
                  <span>{!r.tracked ? '—' : r.nextChapter || <span className="pol-chip green">Internship complete</span>}</span>
                </div>
                <div className="cur-card-foot">
                  <span>{r.lastDeliveredAt ? <>Last delivered <b>{dayjs(r.lastDeliveredAt).format('D MMM YYYY')}</b></> : 'Not started'}</span>
                  <span className="cur-card-go">Open <ArrowRightOutlined /></span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════ STUDENT — read-only, own batch ═══════════ */
function StudentCurriculum() {
  const [batch, setBatch] = useState(null); // { name, ... } or null once resolved
  const [sessions, setSessions] = useState([]);
  const [resolvedTrack, setResolvedTrack] = useState(null);
  const [loading, setLoading] = useState(true);
  const list = useLearnerList(sessions, {
    getSearchText: (s) => [s.unit, s.chapter, s.topic, s.title, s.className, s.status].filter(Boolean).join(' '),
    getFilterValue: (s) => s.status,
  });

  useEffect(() => {
    (async () => {
      const d = await lmsApi.studentDashboard();
      const enrolment = ((d && d.result && d.result.courses) || []).find((c) => c.batch);
      if (!enrolment) { setLoading(false); return; }
      const res = await lmsApi.assessmentCurriculumSessions({ batch: enrolment.batch });
      const data = (res && res.result) || {};
      setBatch({ name: enrolment.batch, course: enrolment.course });
      setResolvedTrack(data.resolvedTrack);
      setSessions(data.sessions || []);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => sessionStats(sessions), [sessions]);

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="pol cur" style={{ padding: 4 }}>
      {!batch ? (
        <div className="pol-empty"><span className="pol-empty-ic"><ScheduleOutlined /></span><b>You&apos;re not on a batch yet</b></div>
      ) : (
        <>
          <BatchHeader
            title="Curriculum Progress"
            percent={stats.percent}
            stats={{ ...stats, behind: 0 }}
            sub={(
              <>
                <span>{batch.name}</span>
                {batch.course && <span>{batch.course}</span>}
                <span>{TRACKS.find((t) => t.value === resolvedTrack)?.label || resolvedTrack}</span>
              </>
            )}
          />
          <LearnerListControls
            search={list.search}
            onSearchChange={list.setSearch}
            searchPlaceholder="Search curriculum sessions…"
            filter={list.filter}
            onFilterChange={list.setFilter}
            filterPlaceholder="All delivery statuses"
            filterOptions={[...new Set(sessions.map((s) => s.status).filter(Boolean))].map((value) => ({
              value,
              label: value.charAt(0) + value.slice(1).toLowerCase(),
            }))}
          />
          <SessionsList sessions={list.filteredRows} loading={loading} />
        </>
      )}
    </div>
  );
}

export default function Curriculum() {
  const admin = useSelector(selectCurrentAdmin) || {};
  // An Admin is not a Teacher and not a Student. Before this they fell
  // through to the student view, which shows one batch — their own, of
  // which they have none — so the page looked empty for the one role that
  // is supposed to see everything.
  if (LMS_FULL_ACCESS_ROLES.includes(admin.role)) return <AdminCurriculum />;
  return LMS_TEACHER_ROLES.includes(admin.role) ? <TeacherCurriculum /> : <StudentCurriculum />;
}
