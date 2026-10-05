import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Button, Modal, Empty, Tag, Skeleton, Tooltip, InputNumber, Input, message } from 'antd';
import { LeftOutlined, RightOutlined, CalendarOutlined, ClockCircleOutlined, ReadOutlined, MoreOutlined, EditOutlined, CheckOutlined, CloseOutlined, LeftOutlined as BackOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import lmsApi from '../api';

// Who can postpone a class that's running late — the class's own instructor,
// Support, or an admin-ish role. Enforced for real server-side (resolveRole,
// see liveClassService.postponeSession); this just hides the control from
// roles/people it would 403 for anyway.
const POSTPONE_ROLES = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];
const POSTPONE_DAY_OPTS = [1, 2, 3, 4];

// Month view of every auto-generated live class (see recurrence.js) across
// every batch — this IS the "batch schedule saved to a calendar" the recurring
// engine already produces; this page just renders it as a grid instead of the
// Live Classes page's flat card list.

const STATUS_META = {
  LIVE: { color: '#dc2626', label: 'Live' },
  STARTING: { color: '#ea580c', label: 'Starting' },
  UPCOMING: { color: '#2563eb', label: 'Upcoming' },
  SCHEDULED: { color: '#4f46e5', label: 'Scheduled' },
  ENDING: { color: '#ea580c', label: 'Ending' },
  RECORDING_PROCESSING: { color: '#9333ea', label: 'Processing' },
  RECORDING_AVAILABLE: { color: '#16a34a', label: 'Recorded' },
  ENDED: { color: '#8c8c8c', label: 'Ended' },
  CANCELLED: { color: '#cf1322', label: 'Cancelled' },
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const t = (v) => (v ? dayjs(v).format('h:mm A') : '—');

// The class's own topic (e.g. "S1 — Python Setup & Environment", see
// services/lms/chapterProgress.js) is what actually matters on a calendar —
// which batch it belongs to is secondary context, not the headline. A class
// with no curriculum topic (e.g. an extra month-filler session past the
// original schedule — see recurrence.js's month-end extension) falls back
// to its own title (the renameable "Class N" / custom name) rather than the
// generic batch name, so renamed extra classes actually show their name.
const primaryLabel = (s) => s.topic || s.title || s.batchName || s.courseTitle;
const secondaryLabel = (s) => (s.topic ? s.batchName || s.courseTitle : null);

export default function LmsCalendar() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const canSeePostpone = POSTPONE_ROLES.includes(admin.role) || admin.role === 'Teacher';

  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dayModal, setDayModal] = useState(null); // dayjs | null

  // Postpone flow: click the "..." on a day card -> pick which class (step 1)
  // -> pick how many days to push it (step 2).
  const [postponeDay, setPostponeDay] = useState(null); // dayjs | null
  const [postponeSession, setPostponeSession] = useState(null); // session | null (step 2 once set)
  const [customDays, setCustomDays] = useState(null);
  const [posting, setPosting] = useState(false);

  // Rename a class (e.g. an auto-generated "Extra class" filler past the
  // original curriculum — see recurrence.js's month-end extension — renamed
  // to whatever actually ran, like "Mock Interview Prep").
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const gridStart = useMemo(() => cursor.startOf('month').startOf('week'), [cursor]);
  const gridEnd = useMemo(() => cursor.endOf('month').endOf('week'), [cursor]);

  const days = useMemo(() => {
    const out = [];
    let d = gridStart;
    while (d.isBefore(gridEnd) || d.isSame(gridEnd, 'day')) {
      out.push(d);
      d = d.add(1, 'day');
    }
    return out;
  }, [gridStart, gridEnd]);

  const reload = useCallback(
    (silent) => {
      if (!silent) setLoading(true);
      return lmsApi
        .liveClassesRange(gridStart.toISOString(), gridEnd.endOf('day').toISOString())
        .then((res) => setSessions(res && res.success ? res.result : []))
        .finally(() => !silent && setLoading(false));
    },
    [gridStart, gridEnd]
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const s of sessions) {
      if (!s.scheduledStart) continue;
      const key = dayjs(s.scheduledStart).format('YYYY-MM-DD');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart));
    return map;
  }, [sessions]);

  const todayKey = dayjs().format('YYYY-MM-DD');
  const modalKey = dayModal ? dayModal.format('YYYY-MM-DD') : null;
  const modalSessions = modalKey ? byDate.get(modalKey) || [] : [];

  const batchCount = new Set(sessions.map((s) => s.batchId || s.batchName)).size;

  const postponeDayKey = postponeDay ? postponeDay.format('YYYY-MM-DD') : null;
  const postponeDayAllSessions = postponeDayKey ? byDate.get(postponeDayKey) || [] : [];
  // Teachers only get to postpone their own classes; managers/Support see
  // the whole day. Only a class that hasn't started yet can be postponed.
  const postponeDaySessions = postponeDayAllSessions.filter(
    (s) =>
      ['SCHEDULED', 'UPCOMING'].includes(s.status) &&
      (POSTPONE_ROLES.includes(admin.role) || (s.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase())
  );

  const closePostpone = () => {
    setPostponeDay(null);
    setPostponeSession(null);
    setCustomDays(null);
  };

  const submitPostpone = async (days) => {
    if (!postponeSession || !days || days < 1) return;
    setPosting(true);
    try {
      const res = await lmsApi.liveClassPostpone(postponeSession.id, days);
      if (res && res.success) {
        message.success(`Postponed by ${days} day${days === 1 ? '' : 's'}.`);
        closePostpone();
        reload(true);
      } else {
        message.error((res && res.message) || 'Could not postpone this class.');
      }
    } catch (e) {
      message.error(e?.message || 'Could not postpone this class.');
    } finally {
      setPosting(false);
    }
  };

  const startRename = (s) => {
    setRenamingId(s.id);
    setRenameValue(primaryLabel(s) || '');
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };
  const saveRename = async (id) => {
    const title = renameValue.trim();
    if (!title) return;
    setRenaming(true);
    try {
      const res = await lmsApi.liveClassUpdate(id, { title });
      if (res && res.success) {
        cancelRename();
        reload(true);
      } else {
        message.error((res && res.message) || 'Could not rename this class.');
      }
    } catch (e) {
      message.error(e?.message || 'Could not rename this class.');
    } finally {
      setRenaming(false);
    }
  };

  return (
    <div className="lms-cal">
      <div className="lms-cal-card">
        <div className="lms-cal-head">
          <div className="lms-cal-title">
            <span className="lms-cal-title-icon"><CalendarOutlined /></span>
            <span>{cursor.format('MMMM YYYY')}</span>
          </div>
          <div className="lms-cal-nav">
            <span className="lms-cal-summary">
              {loading ? 'Loading…' : `${sessions.length} class${sessions.length === 1 ? '' : 'es'} · ${batchCount} batch${batchCount === 1 ? '' : 'es'}`}
            </span>
            <div className="lms-cal-nav-btns">
              <Button size="small" icon={<LeftOutlined />} onClick={() => setCursor((c) => c.subtract(1, 'month'))} />
              <Button size="small" onClick={() => setCursor(dayjs().startOf('month'))}>Today</Button>
              <Button size="small" icon={<RightOutlined />} onClick={() => setCursor((c) => c.add(1, 'month'))} />
            </div>
          </div>
        </div>

        <div className="lms-cal-weekdays">
          {WEEKDAYS.map((w) => (
            <div key={w} className="lms-cal-weekday">{w}</div>
          ))}
        </div>

        {loading ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : (
          <div className="lms-cal-grid">
            {days.map((d) => {
              const key = d.format('YYYY-MM-DD');
              const list = byDate.get(key) || [];
              const inMonth = d.isSame(cursor, 'month');
              const isToday = key === todayKey;
              const shown = list.slice(0, 3);
              const extra = list.length - shown.length;
              return (
                <div
                  key={key}
                  className={`lms-cal-cell${inMonth ? '' : ' is-outside'}${isToday ? ' is-today' : ''}${list.length ? ' has-classes' : ''}`}
                  onClick={() => list.length && setDayModal(d)}
                >
                  {canSeePostpone && list.length > 0 && (
                    <button
                      type="button"
                      className="lms-cal-more-btn"
                      aria-label="Class options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPostponeSession(null);
                        setPostponeDay(d);
                      }}
                    >
                      <MoreOutlined />
                    </button>
                  )}
                  <span className="lms-cal-daynum">{d.date()}</span>
                  <div className="lms-cal-items">
                    {shown.map((s) => (
                      <Tooltip
                        key={s.id}
                        overlayClassName="lms-cal-tooltip"
                        title={
                          <div className="lms-cal-tooltip-body">
                            <div className="lms-cal-tooltip-time">{t(s.scheduledStart)}–{t(s.scheduledEnd)}</div>
                            <div className="lms-cal-tooltip-name">{primaryLabel(s)}</div>
                            {secondaryLabel(s) && <div className="lms-cal-tooltip-topic"><ReadOutlined /> {secondaryLabel(s)}</div>}
                          </div>
                        }
                      >
                        <div
                          className="lms-cal-chip"
                          style={{ '--chip-color': (STATUS_META[s.status] || {}).color || '#475569' }}
                        >
                          <span className="lms-cal-chip-dot" />
                          <span className="lms-cal-chip-time">{t(s.scheduledStart)}</span>
                          <span className="lms-cal-chip-name">{primaryLabel(s)}</span>
                        </div>
                      </Tooltip>
                    ))}
                    {extra > 0 && <div className="lms-cal-more">+{extra} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        className="crud-modal lms-cal-modal"
        open={!!dayModal}
        onCancel={() => {
          setDayModal(null);
          cancelRename();
        }}
        footer={null}
        destroyOnClose
        width={520}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><CalendarOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">{dayModal ? dayModal.format('dddd') : ''}</span>
              <span className="crud-modal-title-main">{dayModal ? dayModal.format('D MMMM YYYY') : ''}</span>
            </span>
          </span>
        }
      >
        {modalSessions.length === 0 ? (
          <Empty description="No classes scheduled." />
        ) : (
          <div className="lms-cal-daylist">
            {modalSessions.map((s) => {
              const meta = STATUS_META[s.status] || { color: '#475569', label: s.status };
              const isRenaming = renamingId === s.id;
              return (
                <div className="lms-cal-daylist-row" key={s.id}>
                  <div className="lms-cal-daylist-clock" style={{ '--chip-color': meta.color }}>
                    <ClockCircleOutlined />
                  </div>
                  <div className="lms-cal-daylist-main">
                    {isRenaming ? (
                      <Input
                        autoFocus
                        size="small"
                        value={renameValue}
                        maxLength={200}
                        disabled={renaming}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onPressEnter={() => saveRename(s.id)}
                      />
                    ) : (
                      <div className="lms-cal-daylist-name">
                        {primaryLabel(s)}
                        {canSeePostpone && (
                          <button
                            type="button"
                            className="lms-cal-rename-btn"
                            aria-label="Rename class"
                            onClick={() => startRename(s)}
                          >
                            <EditOutlined />
                          </button>
                        )}
                      </div>
                    )}
                    <div className="lms-cal-daylist-sub">
                      {t(s.scheduledStart)}–{t(s.scheduledEnd)}
                      {s.teacherName ? ` · ${s.teacherName}` : ''}
                    </div>
                    {!isRenaming && secondaryLabel(s) && <div className="lms-cal-daylist-topic"><ReadOutlined /> {secondaryLabel(s)}</div>}
                  </div>
                  {isRenaming ? (
                    <div className="lms-cal-daylist-renameacts">
                      <Button size="small" type="text" icon={<CheckOutlined />} loading={renaming} onClick={() => saveRename(s.id)} />
                      <Button size="small" type="text" icon={<CloseOutlined />} disabled={renaming} onClick={cancelRename} />
                    </div>
                  ) : (
                    <Tag color={meta.color} className="lms-cal-daylist-tag">{meta.label}</Tag>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal
        className="crud-modal lms-cal-modal"
        open={!!postponeDay}
        onCancel={closePostpone}
        footer={null}
        destroyOnClose
        width={460}
        title={
          <span className="crud-modal-title">
            <span className="crud-modal-title-icon"><ClockCircleOutlined /></span>
            <span>
              <span className="crud-modal-title-kicker">{postponeDay ? postponeDay.format('dddd, D MMMM') : ''}</span>
              <span className="crud-modal-title-main">{postponeSession ? 'Postpone class' : 'Select a class to postpone'}</span>
            </span>
          </span>
        }
      >
        {!postponeSession ? (
          postponeDaySessions.length === 0 ? (
            <Empty description="No postponable class here." />
          ) : (
            <div className="lms-cal-daylist">
              {postponeDaySessions.map((s) => (
                <div
                  className="lms-cal-daylist-row lms-cal-daylist-row-clickable"
                  key={s.id}
                  onClick={() => setPostponeSession(s)}
                >
                  <div className="lms-cal-daylist-clock" style={{ '--chip-color': (STATUS_META[s.status] || {}).color }}>
                    <ClockCircleOutlined />
                  </div>
                  <div className="lms-cal-daylist-main">
                    <div className="lms-cal-daylist-name">{primaryLabel(s)}</div>
                    <div className="lms-cal-daylist-sub">
                      {t(s.scheduledStart)}–{t(s.scheduledEnd)}
                      {s.teacherName ? ` · ${s.teacherName}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="lms-cal-postpone-body">
            <button type="button" className="lms-cal-back-link" onClick={() => setPostponeSession(null)}>
              <BackOutlined /> Back
            </button>
            <div className="lms-cal-postpone-current">
              <div className="lms-cal-daylist-name">{primaryLabel(postponeSession)}</div>
              <div className="lms-cal-daylist-sub">Currently {t(postponeSession.scheduledStart)}–{t(postponeSession.scheduledEnd)}</div>
            </div>
            <div className="lms-cal-postpone-label">Postpone by</div>
            <div className="lms-cal-postpone-opts">
              {POSTPONE_DAY_OPTS.map((n) => (
                <Button key={n} disabled={posting} onClick={() => submitPostpone(n)}>
                  {n}d
                </Button>
              ))}
              <InputNumber
                min={1}
                max={90}
                placeholder="Custom"
                value={customDays}
                onChange={setCustomDays}
                disabled={posting}
                style={{ width: 90 }}
              />
              <Button type="primary" disabled={posting || !customDays} loading={posting} onClick={() => submitPostpone(customDays)}>
                Apply
              </Button>
            </div>
            <div className="lms-cal-postpone-note">
              This also shifts every later not-yet-started class in the same batch's schedule. If a shifted date lands on a
              Saturday/Sunday, it moves to the following Monday instead.
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
