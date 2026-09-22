import React, { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Empty, Tag, Skeleton, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined, CalendarOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import lmsApi from '../api';

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

export default function LmsCalendar() {
  const [cursor, setCursor] = useState(() => dayjs().startOf('month'));
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dayModal, setDayModal] = useState(null); // dayjs | null

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    lmsApi
      .liveClassesRange(gridStart.toISOString(), gridEnd.endOf('day').toISOString())
      .then((res) => {
        if (cancelled) return;
        setSessions(res && res.success ? res.result : []);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [gridStart, gridEnd]);

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
                  <span className="lms-cal-daynum">{d.date()}</span>
                  <div className="lms-cal-items">
                    {shown.map((s) => (
                      <Tooltip
                        key={s.id}
                        overlayClassName="lms-cal-tooltip"
                        title={
                          <div className="lms-cal-tooltip-body">
                            <div className="lms-cal-tooltip-time">{t(s.scheduledStart)}–{t(s.scheduledEnd)}</div>
                            <div className="lms-cal-tooltip-name">{s.batchName || s.courseTitle || s.title}</div>
                          </div>
                        }
                      >
                        <div
                          className="lms-cal-chip"
                          style={{ '--chip-color': (STATUS_META[s.status] || {}).color || '#475569' }}
                        >
                          <span className="lms-cal-chip-dot" />
                          <span className="lms-cal-chip-time">{t(s.scheduledStart)}</span>
                          <span className="lms-cal-chip-name">{s.batchName || s.courseTitle || s.title}</span>
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
        onCancel={() => setDayModal(null)}
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
              return (
                <div className="lms-cal-daylist-row" key={s.id}>
                  <div className="lms-cal-daylist-clock" style={{ '--chip-color': meta.color }}>
                    <ClockCircleOutlined />
                  </div>
                  <div className="lms-cal-daylist-main">
                    <div className="lms-cal-daylist-name">{s.batchName || s.courseTitle || s.title}</div>
                    <div className="lms-cal-daylist-sub">
                      {t(s.scheduledStart)}–{t(s.scheduledEnd)}
                      {s.teacherName ? ` · ${s.teacherName}` : ''}
                    </div>
                  </div>
                  <Tag color={meta.color} className="lms-cal-daylist-tag">{meta.label}</Tag>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
