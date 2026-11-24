import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, Chip, Btn, Card, Row, Col, Field, Table, Toggle, Check, Slider, Lbl, KV, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 3E "Engagement rules, scoring & alerts" (Admin; Support read-only).

const ACTIVE = [
  ['editor', 'Typing / running code in the editor'],
  ['lesson', 'Scrolling or reading a lesson page'],
  ['video', 'Video playing (tab visible)'],
  ['assessment', 'Answering an assessment'],
  ['live', 'Live class attendance'],
  ['hiddenTab', 'Tab hidden or window minimised'],
];
const WEIGHTS = [
  ['practiceTime', 'Practice time', C.pri],
  ['completion', 'Content completion', C.ind],
  ['exercises', 'Exercises completed', C.pu],
  ['streak', 'Consistency (streak)', C.or],
];
const hr = (h) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
const GOALS = [30, 45, 60, 90, 120, 150, 180];

export default function EngagementRules() {
  const q = useData(() => api.config(), []);
  const [e, setE] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) setE(JSON.parse(JSON.stringify(q.data.engagement)));
  }, [q.data]);
  if (q.loading && !e) return <Loading />;
  if (q.error) return <ErrorBox text={q.error} />;
  if (!e) return null;
  const canEdit = !!q.data.canEdit;
  const tot = WEIGHTS.reduce((s, [k]) => s + (Number(e.weights[k]) || 0), 0);
  const set = (path, v) => {
    const n = JSON.parse(JSON.stringify(e));
    const ks = path.split('.');
    let o = n;
    ks.slice(0, -1).forEach((k) => {
      o = o[k];
    });
    o[ks[ks.length - 1]] = v;
    setE(n);
  };
  const save = async () => {
    if (tot !== 100) return message.error('Weights must total 100%.');
    setBusy(true);
    const r = await api.saveConfig({ engagement: e });
    setBusy(false);
    if (r.success) {
      message.success('Engagement settings saved');
      q.reload();
    } else message.error(r.message);
  };
  const R = e.rules;
  const RULES = [
    ['inactiveMentor', <>Learner inactive for <NumIn v={R.inactiveMentor.days} on={(v) => set('rules.inactiveMentor.days', v)} dis={!canEdit} /> days</>, 'Assigned mentor', 'In-app + email'],
    ['inactiveSupport', <>Learner inactive for <NumIn v={R.inactiveSupport.days} on={(v) => set('rules.inactiveSupport.days', v)} dis={!canEdit} /> days</>, 'Support outreach queue (Inactive Learners)', 'Queue + email'],
    ['lowStreak', <>Low Engagement for <NumIn v={R.lowStreak.days} on={(v) => set('rules.lowStreak.days', v)} dis={!canEdit} /> days in a row</>, 'Mentor', 'In-app'],
    ['missedLive', <>Missed <NumIn v={R.missedLive.count} on={(v) => set('rules.missedLive.count', v)} dis={!canEdit} /> live classes in a week</>, 'Mentor + learner', 'In-app'],
    ['streakBroken', <>Streak of <NumIn v={R.streakBroken.days} on={(v) => set('rules.streakBroken.days', v)} dis={!canEdit} />+ days broken</>, 'Learner', 'In-app'],
    ['readinessLow', <>Readiness drops below <NumIn v={R.readinessLow.below} on={(v) => set('rules.readinessLow.below', v)} dis={!canEdit} /></>, 'Mentor + admin', 'Email'],
  ];

  return (
    <Screen
      crumb="LMS / Engagement Rules"
      title="Engagement settings"
      actions={
        canEdit ? (
          <Btn k="p" i="check" onClick={save} disabled={busy || tot !== 100}>
            {busy ? 'Saving…' : 'Save settings'}
          </Btn>
        ) : (
          <Chip tone="pu" i="eye">
            Support · read-only
          </Chip>
        )
      }
    >
      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="Active time & idle detection" i="clock" style={{ flex: 1 }}>
          <Field label="Idle timeout" htmlFor="e-idle">
            <select id="e-idle" className="g-input" value={e.idleTimeoutMin} disabled={!canEdit} onChange={(ev) => set('idleTimeoutMin', Number(ev.target.value))}>
              {[1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} minute{n === 1 ? '' : 's'} without activity
                </option>
              ))}
            </select>
          </Field>
          <Lbl>Counts as active</Lbl>
          {ACTIVE.map(([k, l]) => (
            <Check key={k} label={l} on={!!e.active[k]} onChange={(v) => canEdit && set(`active.${k}`, v)} s={12.5} />
          ))}
        </Card>

        <Card title="Engagement score weights" i="settings" sub={`Total ${tot}%${tot === 100 ? '' : ' — must be 100%'}`} style={{ flex: 1 }}>
          {WEIGHTS.map(([k, l, col]) => (
            <Col key={k} g={6}>
              <KV
                k={l}
                v={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <input type="number" min={0} max={100} value={e.weights[k]} disabled={!canEdit} onChange={(ev) => set(`weights.${k}`, Math.max(0, Math.min(100, Number(ev.target.value) || 0)))} style={{ width: 40, border: `1px solid ${C.ln}`, borderRadius: 6, textAlign: 'right', fontWeight: 600 }} aria-label={`${l} weight`} />
                    <b> %</b>
                  </span>
                }
              />
              <Slider value={Math.min(40, e.weights[k])} max={40} col={col} onChange={(v) => canEdit && set(`weights.${k}`, v)} label={`${l} weight`} />
            </Col>
          ))}
          <Lbl>Levels</Lbl>
          <Row g={8} className="g-wrap g-ac">
            <Chip tone="ok" dot s={12}>
              Highly Engaged ≥ <NumIn v={e.levels.high} on={(v) => set('levels.high', v)} dis={!canEdit} plain />
            </Chip>
            <Chip tone="wa" dot s={12}>
              Moderate <NumIn v={e.levels.moderate} on={(v) => set('levels.moderate', v)} dis={!canEdit} plain />–{e.levels.high - 1}
            </Chip>
            <Chip tone="er" dot s={12}>
              Low &lt; {e.levels.moderate}
            </Chip>
          </Row>
        </Card>

        <Card title="Daily goals & reminders" i="target" style={{ width: 360, flexShrink: 0 }}>
          <Field label="Default daily goal" htmlFor="e-goal">
            <select id="e-goal" className="g-input" value={e.dailyGoalMin} disabled={!canEdit} onChange={(ev) => set('dailyGoalMin', Number(ev.target.value))}>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {g >= 60 ? `${g / 60} hour${g === 60 ? '' : 's'}` : `${g} minutes`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reminder time" htmlFor="e-rem">
            <select id="e-rem" className="g-input" value={e.reminderHour} disabled={!canEdit} onChange={(ev) => set('reminderHour', Number(ev.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hr(h)} (learner can change)
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quiet hours">
            <Row g={6} className="g-ac">
              <select className="g-input" value={e.quiet.from} disabled={!canEdit} onChange={(ev) => set('quiet.from', Number(ev.target.value))} aria-label="Quiet hours from">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hr(h)}
                  </option>
                ))}
              </select>
              <span className="g-mut">–</span>
              <select className="g-input" value={e.quiet.to} disabled={!canEdit} onChange={(ev) => set('quiet.to', Number(ev.target.value))} aria-label="Quiet hours to">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hr(h)}
                  </option>
                ))}
              </select>
            </Row>
          </Field>
          {[
            ['streakRisk', 'Streak-at-risk reminder'],
            ['weeklyEmail', 'Weekly progress email'],
            ['showIn360', 'Show engagement in 360° report'],
          ].map(([k, l]) => (
            <Row key={k} g={10} className="g-ac">
              <span style={{ fontSize: 12.5, flex: 1 }}>{l}</span>
              <Toggle on={!!e[k]} disabled={!canEdit} onChange={(v) => set(k, v)} label={l} />
            </Row>
          ))}
        </Card>
      </Row>

      <Card title="Alert rules" i="bell" sub="Checked every hour for every active learner">
        <Table
          cols={[
            ['When', 'f'],
            ['Then notify', 240],
            ['Channel', 150],
            ['Active', 70],
          ]}
          rows={RULES.map(([k, when, who, ch]) => [when, who, ch, <Toggle on={!!R[k].on} disabled={!canEdit} onChange={(v) => set(`rules.${k}.on`, v)} label={`${k} rule`} />])}
        />
      </Card>
    </Screen>
  );
}

function NumIn({ v, on, dis, plain }) {
  return (
    <input
      type="number"
      min={1}
      max={100}
      value={v}
      disabled={dis}
      onChange={(e) => on(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
      style={{ width: 38, border: plain ? 0 : `1px solid ${C.ln}`, borderRadius: 6, padding: '1px 4px', textAlign: 'center', fontWeight: 600, background: plain ? 'transparent' : C.w, color: 'inherit', font: 'inherit' }}
      aria-label="number"
    />
  );
}
