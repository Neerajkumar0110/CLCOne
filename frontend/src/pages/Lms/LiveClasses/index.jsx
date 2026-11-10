import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Row,
  Col,
  Card,
  Tag,
  Button,
  Alert,
  Skeleton,
  Empty,
  Tooltip,
  message,
  Modal,
  Table,
  Form,
  DatePicker,
  InputNumber,
  Checkbox,
} from 'antd';
import dayjs from 'dayjs';
import {
  VideoCameraOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  LoginOutlined,
  StopOutlined,
  TeamOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  PlaySquareOutlined,
  FieldTimeOutlined,
  UserAddOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import lmsApi from '../api';

// Who may delete a class / switch a batch's classes off (backend
// requireManager → LMS_FULL_ACCESS_ROLES: Admin, Super Admin, owner, Support).
const MANAGER_ROLES = ['owner', 'Super Admin', 'Admin', 'Support'];
import BatchStudentsPanel from '../components/BatchStudentsPanel';
import DevicePreflightModal from '../components/DevicePreflightModal';
import ClassDetailDrawer, { ClassBoard, classTitle } from './ClassDetailDrawer';

// Live Classes — auto-generated per batch/course. No manual meeting link:
// Join asks the backend for a one-time redirect (teacher -> host,
// student -> attendee); the meeting URL is never in the DOM.

const STATUS_META = {
  LIVE: { color: 'red', order: 0, label: 'LIVE' },
  STARTING: { color: 'orange', order: 1, label: 'STARTING…' },
  UPCOMING: { color: 'blue', order: 2, label: 'UPCOMING' },
  SCHEDULED: { color: 'geekblue', order: 3, label: 'SCHEDULED' },
  ENDING: { color: 'orange', order: 4, label: 'ENDING…' },
  RECORDING_PROCESSING: { color: 'purple', order: 5, label: 'RECORDING PROCESSING' },
  RECORDING_AVAILABLE: { color: 'green', order: 6, label: 'RECORDING READY' },
  ENDED: { color: 'default', order: 7, label: 'ENDED' },
  CANCELLED: { color: 'default', order: 9, label: 'CANCELLED' },
};

const d = (v) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  } catch (e) {
    return '—';
  }
};
// Display-only relabelling of the attendance roll's stored participant role
// ('teacher'/'student'/'manager', see liveClassService.js#attendanceRows) —
// the value itself is untouched, just what's shown in the table.
const ROLE_LABEL = { teacher: 'Project Manager', student: 'Candidate', manager: 'Manager' };
const t = (v) => {
  if (!v) return '';
  try {
    return new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '';
  }
};

// Body of a confirm dialog: what will happen, one short point per line.
function ConfirmPoints({ points }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {points.map((p) => (
        <li key={p} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.45, marginTop: 9, flex: '0 0 auto' }} />
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}

// One contextual "what's going on with this class right now" line — icon +
// title + description — that anchors the card's bottom panel. Everything
// here is derived from fields the backend already sends (status, role,
// canStart/canJoin/etc.), just organized as a single message instead of the
// old flat row of independently-conditioned buttons.
function getStatusPanel(r) {
  const isLive = r.status === 'LIVE' || r.status === 'STARTING';
  if (r.status === 'RECORDING_PROCESSING') {
    return { icon: <TeamOutlined />, tone: 'purple', title: 'Recording processing…', desc: 'Your session is being processed for playback.' };
  }
  if (r.status === 'RECORDING_AVAILABLE') {
    return { icon: <PlaySquareOutlined />, tone: 'green', title: 'Recording ready', desc: 'Watch the recorded session anytime.' };
  }
  if (r.status === 'ENDING') {
    return { icon: <ClockCircleOutlined />, tone: 'orange', title: 'Wrapping up…', desc: 'This class is ending.' };
  }
  if (r.status === 'ENDED') {
    return { icon: <CheckCircleOutlined />, tone: 'default', title: 'Class ended', desc: 'This class has finished.' };
  }
  if (r.status === 'CANCELLED') {
    return { icon: <StopOutlined />, tone: 'default', title: 'Cancelled', desc: 'This class was cancelled.' };
  }
  if (isLive) {
    return {
      icon: <VideoCameraOutlined />,
      tone: 'red',
      title: 'Class is live',
      desc: r.participantsOnline ? `${r.participantsOnline} online now` : 'Join to participate.',
    };
  }
  // SCHEDULED / UPCOMING — canStart is teacher-only and, once the class is
  // still in this status, is false either because its scheduled window has
  // already closed, or because it hasn't opened yet (a batch's whole
  // recurrence — e.g. ~130 daily sessions — is generated up front, so a
  // far-future day sits in this same status from day one; see backend
  // liveClassService.js's hasScheduleEnded/hasScheduleNotStartedYet).
  // Disambiguate by comparing scheduledStart to now rather than showing
  // "Time passed" for a class that's actually still ahead of us.
  if (r.myRole === 'teacher' && !r.canStart) {
    const notYetOpen = r.scheduledStart && new Date(r.scheduledStart).getTime() > Date.now();
    if (notYetOpen) {
      return { icon: <ClockCircleOutlined />, tone: 'blue', title: 'Not open yet', desc: `You can start this up to 10 minutes early — ${t(r.scheduledStart)}.` };
    }
    return { icon: <ClockCircleOutlined />, tone: 'default', title: 'Time passed', desc: "This class wasn't started." };
  }
  if (r.autoStartAt) {
    return { icon: <ClockCircleOutlined />, tone: 'blue', title: 'Auto-starts soon', desc: `Starts automatically at ${t(r.scheduledStart)}.` };
  }
  if (r.myRole === 'teacher') {
    return { icon: <PlayCircleOutlined />, tone: 'blue', title: 'Ready to start', desc: 'Start the class whenever you are ready.' };
  }
  return { icon: <ClockCircleOutlined />, tone: 'blue', title: 'Not started yet', desc: 'Waiting for the project manager to start the class.' };
}

// registrable domain, e.g. clcone.careerlabconsulting.com → careerlabconsulting.com
// (keeps one more label for co.in-style suffixes)
function siteOf(host) {
  const p = String(host || '').toLowerCase().split('.').filter(Boolean);
  if (p.length <= 2) return p.join('.');
  const two = p.slice(-2);
  return (two[1].length === 2 && ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(two[0]) ? p.slice(-3) : two).join('.');
}
export function canEmbed(meetingHost) {
  if (!meetingHost) return true; // no meeting server reported (mock rooms) — previous behaviour
  try {
    return siteOf(window.location.hostname) === siteOf(meetingHost);
  } catch (e) {
    return false;
  }
}

export default function LiveClasses() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [attFor, setAttFor] = useState(null);
  const [att, setAtt] = useState([]);
  const [editFor, setEditFor] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm] = Form.useForm();
  const [addFor, setAddFor] = useState(null);
  const [policy, setPolicy] = useState(null);
  const [preflight, setPreflight] = useState(null); // row awaiting device check
  const [detailFor, setDetailFor] = useState(null); // learner's class detail drawer
  const timer = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The panel (/learn, /teacher) routes with paths; the CRM's LMS module
  // still uses its hash route for Recordings.
  const panelBase = pathname.startsWith('/learn') ? '/learn' : pathname.startsWith('/teacher') ? '/teacher' : null;
  const openRecordings = () => (panelBase ? navigate(`${panelBase}/recordings`) : (window.location.hash = '#/lms/recordings'));
  const admin = useSelector(selectCurrentAdmin) || {};
  const isManager = MANAGER_ROLES.includes(admin.role);
  const isLearner = panelBase === '/learn';
  const meName = `${admin.name || ''} ${admin.surname || ''}`.trim();
  const [focusId, setFocusId] = useState(null); // learner board: class picked from the list
  const [listTab, setListTab] = useState('upcoming');
  const [listMore, setListMore] = useState(false);
  const [paused, setPaused] = useState([]); // batches whose classes are switched off

  const loadPaused = useCallback(async () => {
    if (!isManager) return;
    const res = await lmsApi.pausedBatches().catch(() => null);
    setPaused((res && res.result) || []);
  }, [isManager]);
  useEffect(() => {
    loadPaused();
  }, [loadPaused]);

  useEffect(() => {
    lmsApi.joinPolicy().then((r) => setPolicy((r && r.result) || null)).catch(() => {});
  }, []);

  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await lmsApi.liveClasses();
      const list = (res && res.result) || [];
      list.sort((a, b) => {
        const so = (STATUS_META[a.status]?.order ?? 9) - (STATUS_META[b.status]?.order ?? 9);
        return so || new Date(a.scheduledStart || 0) - new Date(b.scheduledStart || 0);
      });
      setRows(list);
    } catch (e) {
      setError('Could not load live classes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 20000);
    return () => clearInterval(timer.current);
  }, [load]);

  const openMeeting = (url) => url && window.open(url, '_blank', 'noopener');
  // Learners run the class inside the L4 board (BBB in the room area).
  // "Naye tab" moves it to a tab with a fresh ticket and drops the iframe,
  // so they're in the meeting once. room = { id, url } | { id, popped }
  const [room, setRoom] = useState(null);
  // The room is embedded only when this page and the meeting server are the
  // same site (clcone + meet.careerlabconsulting.com). From any other host
  // (localhost, a preview domain) the browser blocks BBB's session cookie
  // inside the iframe and BBB shows "Oops, something went wrong" — there the
  // class opens in a new tab instead.
  const enter = (id, url, host) => {
    if (!isLearner) return openMeeting(url);
    if (canEmbed(host)) return setRoom({ id, url });
    // another site: the full BBB client in a new tab, on a fresh ticket
    // (the one in hand was issued for the embedded layout)
    const w = window.open('', '_blank');
    return lmsApi
      .liveClassJoin(id)
      .then((r) => {
        const u = r && r.result && r.result.url;
        if (w && u) {
          w.opener = null;
          w.location.href = u;
        } else if (w) w.close();
      })
      .catch(() => w && w.close());
  };
  const popOut = async (id) => {
    const w = window.open('', '_blank'); // inside the click, before the await — not popup-blocked
    setRoom({ id, popped: true });
    const res = await lmsApi.liveClassJoin(id).catch(() => null);
    const url = res && res.result && res.result.url;
    if (w && url) {
      w.opener = null;
      w.location.href = url;
      return;
    }
    if (w) w.close();
    if (url) setRoom({ id, url });
    else {
      setRoom(null);
      message.warning((res && res.message) || 'Could not open a new tab — click "Join class" again.');
    }
  };

  // Students can't enter before the host (backend issueJoin → waitForHost):
  // a waiting modal re-checks every 12s and offers Join the moment the
  // trainer is in. The Join itself stays a click — a popup opened from a
  // timer would be blocked by the browser.
  const [waiting, setWaiting] = useState(null); // { id, url? }
  useEffect(() => {
    if (!waiting || waiting.url) return undefined;
    const t = setInterval(async () => {
      const res = await lmsApi.liveClassJoin(waiting.id, isLearner ? { embed: true } : {}).catch(() => null);
      if (res && res.result && res.result.url) setWaiting((w) => (w && w.id === waiting.id ? { ...w, url: res.result.url, host: res.result.meetingHost } : w));
    }, 12000);
    return () => clearInterval(t);
  }, [waiting]);

  const onJoin = async (id) => {
    setBusyId(id);
    try {
      const res = await lmsApi.liveClassJoin(id, isLearner ? { embed: true } : {});
      // Staff join in a real new tab (BBB's own client; role-based toolbar /
      // moderator controls come from the provider itself, see
      // BigBlueButtonProvider.getJoinUrl); learners inside the L4 board.
      if (res && res.result && res.result.url) enter(id, res.result.url, res.result.meetingHost);
      else if (res && res.waitForHost) setWaiting({ id });
      else message.warning((res && res.message) || 'Could not join.');
    } catch (e) {
      message.error('Could not join.');
    } finally {
      setBusyId(null);
      load(true);
    }
  };
  // Student joins go through the device pre-check (spec §6) when the admin
  // has it enabled; teachers/hosts skip straight through (they're not the
  // ones the camera-on policy targets).
  const handleJoin = (r) => {
    if (r.myRole === 'teacher' || !policy || !policy.deviceCheckRequired) return onJoin(r.id);
    setPreflight(r);
  };

  const onStart = async (id) => {
    setBusyId(id);
    try {
      const res = await lmsApi.liveClassStart(id);
      if (res && res.success === false) message.warning(res.message || 'Could not start.');
      else await onJoin(id);
    } finally {
      setBusyId(null);
      load(true);
    }
  };
  const onEnd = (id) =>
    Modal.confirm({
      centered: true,
      icon: <StopOutlined style={{ color: '#dc2626' }} />,
      title: 'End this class?',
      content: <ConfirmPoints points={['Candidates are disconnected.', 'Recording stops and attendance is finalised.']} />,
      okText: 'End class',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusyId(id);
        try {
          await lmsApi.liveClassEnd(id);
          message.success('Class ended.');
        } finally {
          setBusyId(null);
          load(true);
        }
      },
    });
  const showAtt = async (r) => {
    setAttFor(r);
    setAtt([]);
    try {
      const res = await lmsApi.liveClassAttendance(r.id);
      setAtt((res && res.result) || []);
    } catch (e) {
      /* teacher-only */
    }
  };

  const openEdit = (r) => {
    setEditFor(r);
    editForm.setFieldsValue({
      scheduledStart: r.scheduledStart ? dayjs(r.scheduledStart) : null,
      scheduledDurationMin: r.scheduledDurationMin || 60,
      autoStartAt: !!r.autoStartAt,
      countsTowardSyllabus: r.countsTowardSyllabus !== false,
    });
  };
  const submitEdit = async () => {
    let v;
    try {
      v = await editForm.validateFields();
    } catch (e) {
      return;
    }
    setEditBusy(true);
    try {
      const res = await lmsApi.liveClassUpdate(editFor.id, {
        scheduledStart: v.scheduledStart ? v.scheduledStart.toISOString() : undefined,
        scheduledDurationMin: v.scheduledDurationMin,
        autoStartAt: !!v.autoStartAt,
        countsTowardSyllabus: !!v.countsTowardSyllabus,
      });
      if (res && res.success === false) message.warning(res.message || 'Could not update the class time.');
      else {
        message.success('Class time updated.');
        setEditFor(null);
      }
    } catch (e) {
      message.error('Could not update the class time.');
    } finally {
      setEditBusy(false);
      load(true);
    }
  };

  const openAdd = (r) => setAddFor(r);

  const onDelete = (r) =>
    Modal.confirm({
      centered: true,
      icon: <DeleteOutlined style={{ color: '#dc2626' }} />,
      title: `Delete ${r.title}?`,
      content: (
        <ConfirmPoints
          points={[
            `${d(r.scheduledStart)}, ${t(r.scheduledStart)} — removed for the project manager and every candidate.`,
            'The batch\'s later classes are renumbered.',
          ]}
        />
      ),
      okText: 'Delete class',
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await lmsApi.liveClassDelete(r.id);
        if (res && res.success === false) message.warning(res.message || 'Could not delete the class.');
        else message.success('Class deleted.');
        load(true);
      },
    });
  const onPauseBatch = (r) =>
    Modal.confirm({
      centered: true,
      icon: <PauseCircleOutlined style={{ color: '#dc2626' }} />,
      title: `Switch off classes for ${r.batchName}?`,
      content: (
        <ConfirmPoints
          points={[
            'All upcoming classes of this batch are taken off.',
            'No class comes up daily until you switch it back on.',
            'The days it stays off move to the end of the schedule — no class is lost.',
          ]}
        />
      ),
      okText: 'Switch off',
      okButtonProps: { danger: true },
      onOk: async () => {
        const res = await lmsApi.batchClassesPause(r.batchId);
        if (res && res.success === false) message.warning(res.message || 'Could not switch off.');
        else message.success(`${r.batchName}: classes switched off.`);
        load(true);
        loadPaused();
      },
    });
  // On at once: the row leaves the list as soon as the server says yes; the
  // classes are rebuilt in the background, so re-fetch a few times as they land.
  const [resumingId, setResumingId] = useState(null);
  const onResumeBatch = async (b) => {
    setResumingId(b.id);
    const res = await lmsApi.batchClassesResume(b.id).catch(() => null);
    setResumingId(null);
    if (!res || res.success === false) {
      message.warning((res && res.message) || 'Could not switch on.');
      return;
    }
    setPaused((p) => p.filter((x) => x.id !== b.id));
    message.success(`${b.name}: classes switched on.`);
    [1500, 5000, 12000].forEach((ms) => setTimeout(() => load(true), ms));
  };

  const liveNow = rows.filter((r) => r.status === 'LIVE');

  const joinModals = (
    <>
      <DevicePreflightModal
        open={!!preflight}
        sessionId={preflight && preflight.id}
        policy={policy}
        onCancel={() => setPreflight(null)}
        onConfirm={() => {
          const id = preflight && preflight.id;
          setPreflight(null);
          if (id) onJoin(id);
        }}
      />
      <Modal
        open={!!waiting}
        onCancel={() => setWaiting(null)}
        footer={null}
        centered
        width={420}
        title={waiting && waiting.url ? 'Your trainer has joined' : 'Waiting for your trainer'}
      >
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          {waiting && waiting.url ? (
            <>
              <CheckCircleOutlined style={{ fontSize: 44, color: '#16a34a' }} />
              <p style={{ margin: '12px 0 18px', color: '#475569' }}>The class is open — you can go in now.</p>
              <Button
                type="primary"
                size="large"
                icon={<LoginOutlined />}
                onClick={() => {
                  enter(waiting.id, waiting.url, waiting.host);
                  setWaiting(null);
                  load(true);
                }}
              >
                Join class
              </Button>
            </>
          ) : (
            <>
              <ClockCircleOutlined spin style={{ fontSize: 40, color: '#2563eb' }} />
              <p style={{ margin: '12px 0 4px', color: '#475569' }}>The class opens for students once the trainer is in.</p>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: 12.5 }}>Keep this window open — we'll let you in automatically.</p>
            </>
          )}
        </div>
      </Modal>
    </>
  );

  // Learner (/learn/classes) = design board L4: the page IS the class board —
  // live now → open for join → next upcoming → the last one — with the
  // rest of the batch's classes in a list below to switch to.
  if (isLearner) {
    if (loading) return <div className="ld-page"><Skeleton active paragraph={{ rows: 8 }} /></div>;
    const nowMs = Date.now();
    const startOf = (r) => new Date(r.scheduledStart || 0).getTime();
    const endOf = (r) => new Date(r.scheduledEnd || r.scheduledStart || 0).getTime();
    const ACTIVE = ['LIVE', 'STARTING', 'ENDING'];
    const upcoming = rows.filter((r) => r.status !== 'CANCELLED' && !ACTIVE.includes(r.status) && ['SCHEDULED', 'UPCOMING'].includes(r.status) && endOf(r) > nowMs).sort((a, b) => startOf(a) - startOf(b));
    const past = rows.filter((r) => !upcoming.includes(r) && !ACTIVE.includes(r.status)).sort((a, b) => startOf(b) - startOf(a));
    const auto = rows.find((r) => r.status === 'LIVE') || rows.find((r) => ACTIVE.includes(r.status)) || rows.find((r) => r.canJoin) || upcoming[0] || past[0] || null;
    // the class the learner is sitting in stays on the board through refreshes
    const focus = (focusId && rows.find((r) => r.id === focusId)) || (room && rows.find((r) => r.id === room.id)) || auto;
    const list = listTab === 'past' ? past : upcoming;
    const shown = list.slice(0, listMore ? 60 : 8);
    const chip = (r) => {
      const m = {
        LIVE: ['red', 'Live'], STARTING: ['naya', 'Open for join'], ENDING: ['adh', 'Closing'], ENDED: ['gray', 'Ended'],
        RECORDING_PROCESSING: ['gray', 'Recording processing'], RECORDING_AVAILABLE: ['hai', 'Recording ready'], CANCELLED: ['gray', 'Cancelled'],
      }[r.status] || ['naya', 'Scheduled'];
      return <span className={`ld-chip ${m[0]}`}>{m[1]}</span>;
    };
    return (
      <>
        {error && <div className="ld-page" style={{ paddingBottom: 0 }}><div className="ld-warn">{error}</div></div>}
        {focus ? (
          <ClassBoard
            key={focus.id}
            row={focus}
            meName={meName}
            onJoin={handleJoin}
            joining={busyId === focus.id}
            room={room && room.id === focus.id ? room : null}
            onPopOut={() => popOut(focus.id)}
            onRoomBack={() => onJoin(focus.id)}
            onLeaveRoom={() => setRoom(null)}
            deviceCheckRequired={!!(policy && policy.deviceCheckRequired)}
            onOpenRecordings={openRecordings}
            onOpenMaterial={() => navigate('/learn/material')}
          />
        ) : (
          <div className="ld-page">
            <div className="ld-head"><div><h1>Live classes</h1><div className="ld-muted ld-sub">Your batch's classes will appear here.</div></div></div>
            <div className="ld-card"><div className="ld-empty">No class is scheduled yet. Classes will appear here once a batch is assigned.</div></div>
          </div>
        )}
        {rows.length > 0 && (
          <div className="ld-page" style={{ paddingTop: 0 }}>
            <section className="ld-card" aria-label="All classes">
              <div className="ld-hd">
                <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <b>Batch classes</b>
                  <button type="button" className="ld-link" style={{ fontSize: 13 }} onClick={() => navigate('/learn/calendar')}>Calendar view →</button>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className={`ld-pill${listTab === 'upcoming' ? ' on' : ''}`} onClick={() => { setListTab('upcoming'); setListMore(false); }}>Upcoming ({upcoming.length})</button>
                  <button type="button" className={`ld-pill${listTab === 'past' ? ' on' : ''}`} onClick={() => { setListTab('past'); setListMore(false); }}>Past ({past.length})</button>
                </span>
              </div>
              {shown.length === 0 ? (
                <div className="ld-empty">{listTab === 'past' ? 'No class has happened yet.' : 'No upcoming class.'}</div>
              ) : (
                <div className="ld-tablewrap">
                  <table className="ld-table cd-list">
                    <thead><tr><th>Class</th><th>Date &amp; time</th><th>Project Manager</th><th>Status</th><th aria-label="Open" /></tr></thead>
                    <tbody>
                      {shown.map((r) => (
                        <tr key={r.id} className={focus && focus.id === r.id ? 'on' : ''}>
                          <td><b>{classTitle(r)}</b></td>
                          <td>{d(r.scheduledStart)} · {t(r.scheduledStart)}{r.scheduledEnd ? `–${t(r.scheduledEnd)}` : ''}</td>
                          <td>{r.teacherName || '—'}</td>
                          <td>{chip(r)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="ld-btn2 sm" onClick={() => { setFocusId(r.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Open</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {list.length > shown.length && (
                <button type="button" className="ld-link" onClick={() => setListMore(true)}>Show more ({list.length - shown.length})</button>
              )}
            </section>
          </div>
        )}
        {joinModals}
      </>
    );
  }

  if (loading) {
    return (
      <div className="lms-portal lms-section-live">
        <Skeleton active paragraph={{ rows: 1 }} />
        <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
          {[0, 1, 2].map((i) => (
            <Col xs={24} sm={12} lg={8} key={i}>
              <Card size="small"><Skeleton active paragraph={{ rows: 2 }} /></Card>
            </Col>
          ))}
        </Row>
      </div>
    );
  }

  return (
    <div className="lms-portal lms-section-live">
      <div className="lms-live-hero">
        <div className="lms-live-hero-info">
          <span className="lms-live-hero-icon"><VideoCameraOutlined /></span>
          <div>
            <h2>Live Classes</h2>
            <p>Rooms are created automatically per batch — no meeting links to manage.</p>
          </div>
        </div>
        <Button className="lms-live-refresh" icon={<ReloadOutlined />} onClick={() => load()}>Refresh</Button>
      </div>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      {isManager && paused.length > 0 && (
        <div className="lms-paused">
          <div className="lms-paused-head">
            <span className="lms-paused-icon"><PauseCircleOutlined /></span>
            <div>
              <div className="lms-paused-title">
                Classes switched off for {paused.length} batch{paused.length > 1 ? 'es' : ''}
              </div>
              <div className="lms-paused-sub">No class comes up for these until you switch them on — the days off move to the end of the schedule.</div>
            </div>
          </div>
          <div className="lms-paused-list">
            {paused.map((b) => (
              <div className="lms-paused-row" key={b.id}>
                <div className="lms-paused-info">
                  <div className="lms-paused-name">
                    {b.name}
                    <span className="lms-paused-pill">OFF</span>
                  </div>
                  <div className="lms-paused-meta">
                    {b.course ? `${b.course} · ` : ''}since {d(b.pausedAt)}
                    {b.pausedBy ? ` · by ${b.pausedBy}` : ''}
                  </div>
                </div>
                <button type="button" className="lms-paused-btn" disabled={resumingId === b.id} onClick={() => onResumeBatch(b)}>
                  <PlayCircleOutlined />
                  {resumingId === b.id ? 'Switching on…' : 'Switch on'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {liveNow.length > 0 && (
        <div className="lms-livenow2">
          <div className="lms-livenow2-head">
            <span className="lms-livenow2-dot" />
            <span className="lms-livenow2-title">LIVE NOW</span>
            <span className="lms-livenow2-count">{liveNow.length} class{liveNow.length > 1 ? 'es' : ''}</span>
          </div>
          <div className="lms-livenow2-list">
            {liveNow.map((r) => (
              <div className="lms-livenow2-row" key={r.id}>
                <div>
                  <div className="lms-livenow2-name">{r.title}</div>
                  <div className="lms-livenow2-sub">{r.courseTitle} · {r.teacherName}</div>
                </div>
                {r.canJoin && (
                  <Button size="small" className="lms-livenow2-btn" loading={busyId === r.id} onClick={() => handleJoin(r)}>
                    {r.myRole === 'teacher' ? 'Join as host' : 'Join live class'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No live classes yet. Create a batch (internship + project manager + start date + class days) and the schedule appears here automatically."
          />
        </Card>
      ) : (
        <div className="live-classes-grid">
          {rows.map((r) => {
            const meta = STATUS_META[r.status] || { color: 'default', label: r.status };
            const busy = busyId === r.id;
            const isLive = r.status === 'LIVE' || r.status === 'STARTING';
            const panel = getStatusPanel(r);
            const providerLabel =
              r.meetingProvider === 'bigbluebutton' ? 'BigBlueButton' : r.meetingProvider === 'jitsi' ? 'Jitsi' : 'Room';
            const providerGlyph = r.meetingProvider === 'bigbluebutton' ? 'B' : r.meetingProvider === 'jitsi' ? 'J' : '•';

            // One primary call-to-action per card — same priority the old
            // flat button row used (Start > Join > Watch recording > Add
            // student), just picked once instead of rendered as a list of
            // independently-conditioned buttons.
            const primaryAction = r.canStart
              ? { icon: <PlayCircleOutlined />, label: 'Start class', onClick: () => onStart(r.id) }
              : r.canJoin
              ? { icon: <LoginOutlined />, label: r.myRole === 'teacher' ? 'Join as host' : 'Join Live Class', onClick: () => handleJoin(r) }
              : r.status === 'RECORDING_AVAILABLE'
              ? { icon: <PlaySquareOutlined />, label: 'Watch Recording', onClick: openRecordings }
              : r.canAddStudent
              ? { icon: <UserAddOutlined />, label: 'Add candidate', onClick: () => openAdd(r) }
              : r.myRole === 'student' && ['SCHEDULED', 'UPCOMING'].includes(r.status)
              ? { label: 'Not started', disabled: true }
              : null;

            const secondaryButtons = [];
            if (r.canEnd) secondaryButtons.push({ key: 'end', icon: <StopOutlined />, label: 'End', onClick: () => onEnd(r.id) });
            if (r.canEditTime) secondaryButtons.push({ key: 'edit', icon: <FieldTimeOutlined />, label: 'Edit time', onClick: () => openEdit(r) });
            if (r.canAddStudent && primaryAction?.label !== 'Add candidate') {
              secondaryButtons.push({ key: 'add', icon: <UserAddOutlined />, label: 'Add candidate', onClick: () => openAdd(r) });
            }
            if (r.myRole === 'teacher') secondaryButtons.push({ key: 'att', icon: <TeamOutlined />, label: 'Attendance', onClick: () => showAtt(r) });
            if (r.myRole === 'student') secondaryButtons.push({ key: 'details', icon: <CalendarOutlined />, label: 'Details & notes', onClick: () => setDetailFor(r) });
            if (isManager && ['SCHEDULED', 'UPCOMING'].includes(r.status)) {
              secondaryButtons.push({ key: 'delete', danger: true, icon: <DeleteOutlined />, label: 'Delete', onClick: () => onDelete(r) });
              if (r.batchId) {
                secondaryButtons.push({ key: 'pause', danger: true, icon: <PauseCircleOutlined />, label: 'Switch off batch', onClick: () => onPauseBatch(r) });
              }
            }

            return (
              <div className="live-class-card" key={r.id}>
                <div className="card-top">
                  <span className="recording-badge" data-tone={meta.color}>
                    {isLive ? <i className="lms-live-badge-dot" /> : <VideoCameraOutlined />}
                    {meta.label}
                  </span>
                  <span className="provider">
                    <span className="provider-logo">{providerGlyph}</span>
                    {providerLabel}
                    {r.isMock ? ' · mock' : ''}
                  </span>
                </div>

                <h2 className="card-title">
                  <span className="title-icon" aria-hidden="true">🎓</span>
                  <span>{r.title}</span>
                </h2>
                <p className="card-subtitle">
                  {r.courseTitle || '—'}{r.batchName ? ` · ${r.batchName}` : ''}
                </p>

                <div className="info-grid">
                  <div className="info-box teacher">
                    <span className="info-icon"><TeamOutlined /></span>
                    <div className="info-content">
                      <div className="info-label">Project Manager</div>
                      <div className="info-value">{r.teacherName || 'TBD'}</div>
                    </div>
                  </div>
                  <div className="info-box date">
                    <span className="info-icon"><CalendarOutlined /></span>
                    <div className="info-content">
                      <div className="info-label">Date</div>
                      <div className="info-value">{d(r.scheduledStart)}</div>
                    </div>
                  </div>
                  <div className="info-box time">
                    <span className="info-icon"><ClockCircleOutlined /></span>
                    <div className="info-content">
                      <div className="info-label">Time</div>
                      <div className="info-value">
                        {t(r.scheduledStart)}{r.scheduledEnd ? ` – ${t(r.scheduledEnd)}` : ''}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card-divider" />

                <div className="recording-section" data-tone={panel.tone}>
                  <div className="recording-content">
                    <span className="recording-icon">{panel.icon}</span>
                    <div className="recording-text">
                      <p className="recording-title">{panel.title}</p>
                      <p className="recording-description">{panel.desc}</p>
                    </div>
                  </div>
                  {primaryAction &&
                    (primaryAction.href ? (
                      <a className="add-student-btn" href={primaryAction.href}>
                        {primaryAction.icon}
                        {primaryAction.label}
                      </a>
                    ) : (
                      <Tooltip title={primaryAction.disabled ? 'You can join once the project manager starts the class.' : ''}>
                        <button
                          type="button"
                          className="add-student-btn"
                          disabled={primaryAction.disabled || busy}
                          onClick={primaryAction.onClick}
                        >
                          {primaryAction.icon}
                          {busy && !primaryAction.disabled ? 'Please wait…' : primaryAction.label}
                        </button>
                      </Tooltip>
                    ))}
                </div>

                {secondaryButtons.length > 0 && (
                  <div className="session-secondary-row">
                    {secondaryButtons.map((btn) => (
                      <button
                        key={btn.key}
                        type="button"
                        className={`attendance-btn${btn.key === 'end' || btn.danger ? ' is-danger' : ''}`}
                        disabled={busy}
                        onClick={btn.onClick}
                      >
                        {btn.icon}
                        {busy && btn.key === 'end' ? 'Ending…' : btn.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!editFor}
        title={editFor ? `Edit class time — ${editFor.title}` : ''}
        onCancel={() => setEditFor(null)}
        onOk={submitEdit}
        okText="Save time"
        confirmLoading={editBusy}
        destroyOnClose
      >
        <p style={{ marginTop: 0, color: 'rgba(0,0,0,0.45)' }}>
          The class link stays the same — only the scheduled start and length change.
        </p>
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item
            name="scheduledStart"
            label="Scheduled start"
            rules={[{ required: true, message: 'Pick a start date & time.' }]}
          >
            <DatePicker showTime format="ddd, D MMM YYYY HH:mm" style={{ width: '100%' }} minuteStep={5} />
          </Form.Item>
          <Form.Item
            name="scheduledDurationMin"
            label="Duration (minutes)"
            rules={[{ required: true, message: 'Enter a duration.' }]}
          >
            <InputNumber min={5} max={600} step={5} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="autoStartAt" valuePropName="checked">
            <Checkbox>Start the class automatically at this time</Checkbox>
          </Form.Item>
          {/* Untick for orientation, doubt-clearing or revision classes.
              The curriculum mapping hands out topics in date order, so a
              class that teaches no syllabus must be skipped or it takes a
              topic name nobody taught and shifts every class after it. */}
          <Form.Item name="countsTowardSyllabus" valuePropName="checked" style={{ marginBottom: 4 }}>
            <Checkbox>Counts toward syllabus</Checkbox>
          </Form.Item>
          <div style={{ marginLeft: 24, marginTop: -4, fontSize: 12, color: '#64748b' }}>
            Untick for orientation, doubt-clearing or revision classes — the recording keeps
            this class&apos;s own name instead of taking the next curriculum topic.
          </div>
        </Form>
      </Modal>

      <BatchStudentsPanel
        open={!!addFor}
        onClose={() => {
          setAddFor(null);
          load(true);
        }}
        batchId={addFor && addFor.batchId}
        batchName={addFor && addFor.batchName}
      />

      <Modal open={!!attFor} title={attFor ? `Attendance — ${attFor.title}` : ''} footer={null} onCancel={() => setAttFor(null)} width={680}>
        <Table
          size="small"
          rowKey={(x) => x.email || x.name}
          dataSource={att}
          pagination={false}
          locale={{ emptyText: 'No joins recorded yet.' }}
          columns={[
            { title: 'Name', dataIndex: 'name' },
            { title: 'Role', dataIndex: 'role', width: 80, render: (v) => ROLE_LABEL[v] || v },
            { title: 'First join', dataIndex: 'firstJoinAt', render: (v) => (v ? t(v) : '—'), width: 90 },
            { title: 'Last left', dataIndex: 'lastLeftAt', render: (v) => (v ? t(v) : '—'), width: 90 },
            { title: 'Min', dataIndex: 'totalDurationMin', width: 60 },
            { title: '%', dataIndex: 'attendancePct', width: 60 },
            { title: 'Joins', dataIndex: 'joinCount', width: 60 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 100,
              render: (v) => (
                <Tag color={v === 'PRESENT' ? 'green' : v === 'LATE' ? 'gold' : v === 'PARTIAL' ? 'orange' : 'default'}>{v}</Tag>
              ),
            },
          ]}
        />
      </Modal>

      {joinModals}

      <ClassDetailDrawer
        row={detailFor && (rows.find((x) => x.id === detailFor.id) || detailFor)}
        onClose={() => setDetailFor(null)}
        onJoin={handleJoin}
        joining={!!detailFor && busyId === detailFor.id}
        deviceCheckRequired={!!(policy && policy.deviceCheckRequired)}
        onOpenRecordings={openRecordings}
        meName={meName}
      />
    </div>
  );
}
