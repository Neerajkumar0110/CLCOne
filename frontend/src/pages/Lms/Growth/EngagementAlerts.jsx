import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, I, Chip, Btn, Av, Card, Row, Col, KPI, Table, Line, Modal, Field, Screen, Loading, ErrorBox, useData, fmtHM, ago } from './ui';

// Figma 3C "Engagement alerts & learner activity" (Mentor).

const KIND_ICON = { inactiveMentor: 'alert', inactiveSupport: 'alert', lowStreak: 'activity', missedLive: 'video', streakBroken: 'flame', readinessLow: 'target', manual: 'bell' };

export default function EngagementAlerts() {
  const [batch, setBatch] = useState('');
  const { data: d, error, loading, reload } = useData(() => api.mentorEngagement(batch || undefined), [batch]);
  const [lvl, setLvl] = useState('');
  const [msg, setMsg] = useState(null); // { id, name, text }
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d && d.needBatch && !batch && d.batches.length) setBatch(d.batches[0]);
  }, [d, batch]);
  if (loading && !d) return <Loading text="Checking your learners' activity…" />;
  if (error) return <ErrorBox text={error} />;
  if (!d) return null;
  const k = d.kpis || {};
  const L = d.levels || { high: 70, moderate: 40 };
  const rows = (d.rows || []).filter((r) => !lvl || (r.level && r.level.key === lvl));
  const run = async (fn) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
    } else message.error(r.message);
  };
  const exportCsv = () => {
    const head = ['Learner', 'Last active', 'Logins / wk', 'Streak', 'Practice / wk (min)', 'Exercises', 'Live classes', 'Doubts', 'Discussions', 'Score', 'Level'];
    const body = rows.map((r) => [r.name, r.lastActive || '', r.logins, r.streak, r.weekMin, `${r.exercises.done}/${r.exercises.att}`, `${r.live.attended}/${r.live.held}`, r.doubts, r.discussions, r.score ?? '', r.level.label]);
    const text = [head, ...body].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'learner-engagement.csv';
    a.click();
  };
  const staleDays = (dt) => (dt ? Math.floor((Date.now() - new Date(dt).getTime()) / 86400000) : null);

  return (
    <Screen
      crumb="LMS / Engagement Alerts"
      title="Engagement · my learners"
      actions={
        d.batches.length > 1 && (
          <div className="g-input" style={{ width: 'auto', padding: '7px 10px' }}>
            <select value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch">
              {!d.needBatch && <option value="">All my batches</option>}
              {d.batches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        )
      }
    >
      <Row className="g-rs">
        <KPI i="sparkle" label="Highly Engaged" val={k.high ?? '—'} sub={`score ≥ ${L.high}`} tone="ok" style={{ flex: 1 }} />
        <KPI i="activity" label="Moderately Engaged" val={k.moderate ?? '—'} sub={`score ${L.moderate}–${L.high - 1}`} tone="wa" style={{ flex: 1 }} />
        <KPI i="alert" label="Low Engagement" val={k.low ?? '—'} sub={`score < ${L.moderate}${k.none ? ` · ${k.none} no activity yet` : ''}`} tone="er" style={{ flex: 1 }} />
        <KPI i="bell" label="Open alerts" val={k.openAlerts ?? '—'} sub={`${k.newToday || 0} new today`} tone="pk" style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="Alerts" i="bell" sub="Rules set by admin (Engagement Rules)" style={{ width: 420, flexShrink: 0 }}>
          {d.alerts.length === 0 && <span className="g-s12 g-fa">No open alerts.</span>}
          {d.alerts.map((a) => {
            const tt = TONE[a.severity] || TONE.wa;
            return (
              <Col key={a.id} g={8} style={{ background: tt[0], borderRadius: 10, padding: 12 }}>
                <Row g={10} className="g-ac">
                  <I n={KIND_ICON[a.kind] || 'bell'} c={tt[1]} s={16} />
                  <b style={{ fontSize: 13, color: tt[1], flex: 1 }}>{a.name}</b>
                  <span style={{ fontSize: 11, color: tt[1] }}>{ago(a.at)}</span>
                </Row>
                <span style={{ fontSize: 12, color: C.ink }}>{a.text}</span>
                <Row g={6} className="g-wrap">
                  <Btn k="s" sm i="send" disabled={busy} onClick={() => run(() => api.nudgeAlert(a.id))} title={a.nudges ? `Nudged ${a.nudges}×` : ''}>
                    Nudge
                  </Btn>
                  <Btn k="s" sm i="msg" onClick={() => setMsg({ id: a.learner, name: a.name, text: '' })}>
                    Message
                  </Btn>
                  <Btn k="s" sm i="headset" disabled={busy || !!a.queue} onClick={() => run(() => api.alertToSupport(a.id))}>
                    {a.queue ? 'With support' : 'Send to support'}
                  </Btn>
                  <Btn k="g" sm i="check" disabled={busy} onClick={() => run(() => api.resolveAlert(a.id))}>
                    Close
                  </Btn>
                </Row>
              </Col>
            );
          })}
        </Card>
        <Card title="Weekly engagement trend" i="activity" sub="Average engagement score of my learners vs batch" style={{ flex: 1 }}>
          {d.trend && d.trend.mine.some((v) => v != null) ? (
            <Line
              series={[
                { d: d.trend.mine, c: C.ok, area: true, dots: true, l: 'My learners' },
                { d: d.trend.batch, c: C.fa, dash: true, l: 'Batch' },
              ]}
              w={640}
              h={200}
              min={0}
              max={100}
              xl={d.trend.weeks}
              legend
            />
          ) : (
            <div className="g-empty">The trend builds up week by week as learners' activity is tracked.</div>
          )}
        </Card>
      </Row>

      <Card
        title="Learner activity"
        i="users"
        right={
          <Row g={8} style={{ width: 'auto' }}>
            <div className="g-input" style={{ width: 'auto', padding: '5px 10px' }}>
              <select value={lvl} onChange={(e) => setLvl(e.target.value)} aria-label="Level" style={{ fontSize: 12, fontWeight: 600 }}>
                <option value="">Level: All</option>
                <option value="high">Level: Highly</option>
                <option value="moderate">Level: Moderate</option>
                <option value="low">Level: Low</option>
                <option value="none">Level: No activity</option>
              </select>
            </div>
            <Btn k="g" sm i="download" onClick={exportCsv} disabled={!rows.length}>
              Export
            </Btn>
          </Row>
        }
      >
        <Table
          cols={[
            ['Learner', 'f'],
            ['Last active', 100],
            ['Logins / wk', 84],
            ['Streak', 60],
            ['Practice / wk', 92],
            ['Exercises', 80],
            ['Live classes', 86],
            ['Doubts', 60],
            ['Discuss.', 64],
            ['Score', 54],
            ['Level', 104],
          ]}
          rows={rows.map((r) => {
            const sd = staleDays(r.lastActive);
            const late = sd != null && sd >= 3;
            return [
              <>
                <Av name={r.name} col={C.ind} s={24} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</span>
              </>,
              <span style={{ fontSize: 12.5, color: late ? C.er : C.sub, fontWeight: late ? 600 : 400 }}>{r.lastActive ? ago(r.lastActive) : 'not yet'}</span>,
              String(r.logins),
              `${r.streak} d`,
              fmtHM(r.weekMin),
              `${r.exercises.done} / ${r.exercises.att}`,
              `${r.live.attended} / ${r.live.held}`,
              String(r.doubts),
              String(r.discussions),
              <b style={{ fontSize: 12.5 }}>{r.score == null ? '—' : r.score}</b>,
              <Chip tone={r.level.tone} dot>
                {r.level.short || 'None'}
              </Chip>,
            ];
          })}
          empty={d.needBatch && !batch ? 'Pick a batch.' : 'No learners here.'}
        />
      </Card>

      <Modal open={!!msg} onClose={() => setMsg(null)} label="Message learner">
        {msg && (
          <>
            <b style={{ fontSize: 16 }}>Message {msg.name}</b>
            <Field label="Message (in-app + email)" htmlFor="m-text">
              <textarea id="m-text" className="g-input" rows={4} value={msg.text} onChange={(e) => setMsg({ ...msg, text: e.target.value })} placeholder="Hi, noticed you've been away — anything blocking you?" />
            </Field>
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setMsg(null)}>
                Cancel
              </Btn>
              <Btn
                k="i"
                i="send"
                disabled={busy || msg.text.trim().length < 3}
                onClick={async () => {
                  await run(() => api.messageLearner(msg.id, msg.text));
                  setMsg(null);
                }}
              >
                Send
              </Btn>
            </Row>
          </>
        )}
      </Modal>
    </Screen>
  );
}
