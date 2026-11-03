import React, { useEffect, useState } from 'react';
import { Drawer, Button, Tabs, Input, Skeleton, message } from 'antd';
import { LoginOutlined, PlaySquareOutlined } from '@ant-design/icons';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import './classDetail.css';

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
const ATT_CHIP = { PRESENT: 'ok', LATE: 'warn', PARTIAL: 'warn', ABSENT: 'bad', EXCUSED: 'gray' };

export default function ClassDetailDrawer({ row, onClose, onJoin, joining, deviceCheckRequired, onOpenRecordings }) {
  const [att, setAtt] = useState(undefined); // undefined = loading, null = none
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [noteAt, setNoteAt] = useState(null);
  const [noteLoading, setNoteLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  return (
    <Drawer open={!!row} onClose={() => { saveNote(); onClose(); }} width={560} title={row.title} destroyOnClose>
      <div className="sh-root cd-root">
        <div className="sh-sub" style={{ marginTop: 0 }}>
          {when(row.scheduledStart)}
          {row.scheduledEnd ? ` – ${clock(row.scheduledEnd)}` : ''} · Project Manager: {row.teacherName || 'TBD'}
        </div>

        {cancelled ? (
          <span className="sh-chip gray" style={{ alignSelf: 'flex-start' }}>Cancelled</span>
        ) : (
          <ol className="cd-steps" aria-label="Class status">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? 'done' : i === step ? 'on' : ''} aria-current={i === step ? 'step' : undefined}>
                {s}
              </li>
            ))}
          </ol>
        )}

        <section className="sh-card">
          <div className="sh-card-hd">
            <b>Join</b>
          </div>
          {row.canJoin ? (
            <>
              <div className="sh-muted">
                {deviceCheckRequired ? 'A quick camera / microphone check runs first. ' : ''}You join through a one-time secure link — it is
                never shown on the page.
              </div>
              <Button type="primary" size="large" icon={<LoginOutlined />} loading={joining} onClick={() => onJoin(row)} style={{ alignSelf: 'flex-start' }}>
                Join class
              </Button>
            </>
          ) : row.status === 'RECORDING_AVAILABLE' ? (
            <Button icon={<PlaySquareOutlined />} onClick={onOpenRecordings} style={{ alignSelf: 'flex-start' }}>
              Watch recording
            </Button>
          ) : (
            <div className="sh-muted">
              {cancelled
                ? 'This class was cancelled.'
                : step >= 3
                ? 'This class has finished.'
                : 'You can join once the project manager starts the class.'}
            </div>
          )}
        </section>

        <section className="sh-card">
          <div className="sh-card-hd">
            <b>Your attendance</b>
            {att && att.status && <span className={`sh-chip ${ATT_CHIP[att.status] || 'gray'}`}>{att.status}</span>}
          </div>
          {att === undefined ? (
            <Skeleton active paragraph={{ rows: 1 }} title={false} />
          ) : att && (att.attendedMin || att.joins) ? (
            <div style={{ fontSize: 14 }}>
              {att.attendedMin} min attended{att.scheduledDurationMin ? ` of ${att.scheduledDurationMin}` : ''} · {att.attendancePct}% ·{' '}
              {att.joins} join{att.joins === 1 ? '' : 's'}
              {att.joins > 1 ? ' (reconnects merged)' : ''}
            </div>
          ) : (
            <div className="sh-muted">{step >= 2 ? 'No attendance recorded for you in this class.' : 'Recorded automatically once you join.'}</div>
          )}
        </section>

        <Tabs
          items={[
            {
              key: 'details',
              label: 'Details',
              children: (
                <div className="cd-details">
                  <div>
                    <div className="sh-muted">Batch</div>
                    <b>{row.batchName || '—'}</b>
                  </div>
                  <div>
                    <div className="sh-muted">Internship</div>
                    <b>{row.courseTitle || '—'}</b>
                  </div>
                  <div>
                    <div className="sh-muted">Topic</div>
                    <b>{(typeof row.topic === 'string' && row.topic) || row.title}</b>
                  </div>
                  <div>
                    <div className="sh-muted">Recording</div>
                    <b>
                      {row.recording && row.recording.enabled
                        ? 'This class is recorded — it appears under Recordings after the class.'
                        : 'This class is not recorded.'}
                    </b>
                  </div>
                </div>
              ),
            },
            {
              key: 'notes',
              label: 'My notes',
              children: noteLoading ? (
                <Skeleton active paragraph={{ rows: 3 }} title={false} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Input.TextArea
                    aria-label="My notes"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={saveNote}
                    autoSize={{ minRows: 6, maxRows: 16 }}
                    maxLength={20000}
                    placeholder="Your private notes for this class — only you can see them."
                  />
                  <div className="sh-card-hd">
                    <span className="sh-muted">
                      {saving ? 'Saving…' : note !== savedNote ? 'Unsaved changes' : noteAt ? `Saved ${when(noteAt)}` : 'Private · saved to your account'}
                    </span>
                    <Button onClick={saveNote} disabled={note === savedNote} loading={saving}>
                      Save notes
                    </Button>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </Drawer>
  );
}
