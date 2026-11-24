import React, { useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, IB, Bar, Card, Row, Col, KPI, Table, Tabs, Donut, Heat, Bars, Leg, Toggle, Check, Lbl, Note, Field, Screen, Loading, ErrorBox, useData, fmtHM, HEAT } from './ui';

// Figma 3A "Practice tracker & daily goals" (Learner).

const WHERE = [
  ['editor', 'code', 'Code editor', C.ind],
  ['lesson', 'book', 'Lessons & reading', C.pri],
  ['video', 'video', 'Videos', C.pu],
  ['assessment', 'checkc', 'Assessments', C.ok],
  ['live', 'users', 'Live classes', C.sky],
];
const GOALS = [30, 45, 60, 90, 120, 150, 180, 240];

export default function PracticeTracker() {
  const [range, setRange] = useState('week');
  const { data: d, error, loading, reload } = useData(() => api.practice(range), [range]);
  const [busy, setBusy] = useState(false);
  if (loading && !d) return <Loading text="Loading your practice…" />;
  if (error) return <ErrorBox text={error} />;
  const k = d.kpis;
  const wk = k.lastWeekMin ? Math.round(((k.weekMin - k.lastWeekMin) / k.lastWeekMin) * 100) : null;
  const totalWhere = WHERE.reduce((s, [key]) => s + (d.where[key] || 0), 0) || 1;
  const save = async (patch) => {
    setBusy(true);
    const r = await api.savePractice(patch);
    setBusy(false);
    if (r.success) reload();
    else message.error(r.message);
  };
  const goalH = d.goalMin / 60;

  return (
    <Screen
      crumb="LMS / Practice Tracker"
      title="My Practice Tracker"
      actions={
        <Tabs
          items={[
            ['day', 'Day'],
            ['week', 'Week'],
            ['month', 'Month'],
          ]}
          act={range}
          onChange={setRange}
        />
      }
    >
      <Row className="g-rs">
        <KPI i="clock" label="Active today" val={fmtHM(k.todayMin)} sub={`Goal ${fmtHM(d.goalMin)} · ${Math.min(100, Math.round((k.todayMin / d.goalMin) * 100))}%`} tone="pri" bar={(k.todayMin / d.goalMin) * 100} style={{ flex: 1 }} />
        <KPI i="activity" label="This week" val={fmtHM(k.weekMin)} sub={wk == null ? 'first tracked week' : `${wk >= 0 ? '+' : ''}${wk}% vs last week`} subColor={wk == null ? undefined : wk >= 0 ? C.okD : C.erD} tone="ind" style={{ flex: 1 }} />
        <KPI i="cal" label="This month" val={fmtHM(k.monthMin)} sub={`Avg ${fmtHM(k.monthMin / Math.max(1, k.monthDays))} / day`} tone="sky" style={{ flex: 1 }} />
        <KPI i="flame" label="Daily streak" val={`${k.streak} day${k.streak === 1 ? '' : 's'}`} sub={`Best: ${k.bestStreak} days`} tone="or" style={{ flex: 1 }} />
        <KPI i="sparkle" label="Engagement score" val={k.score == null ? '—' : k.score} sub={k.level.label} tone={k.level.tone === 'mut' ? 'ok' : k.level.tone} bar={k.score || 0} style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="Today's goal" i="target" sub="Set by you · default from admin" style={{ width: 340, flexShrink: 0 }}>
          <Row g={14} className="g-ac">
            <Donut
              segs={[
                { v: d.goal.pct, c: C.pri },
                { v: 100 - d.goal.pct, c: C.bg2 },
              ]}
              s={120}
              ir={0.78}
              center={`${d.goal.pct}%`}
              cl={`${fmtHM(k.todayMin)} / ${fmtHM(d.goalMin)}`}
            />
            <Col g={8} style={{ flex: 1 }}>
              {d.goal.items.map((it) => (
                <Check key={it.label} label={it.label} on={it.done} s={12} />
              ))}
            </Col>
          </Row>
          <Field label="Daily practice goal" htmlFor="pt-goal">
            <select id="pt-goal" className="g-input" value={d.prefs.goalMin || ''} disabled={busy} onChange={(e) => save({ goalMin: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Default ({fmtHM(d.defaultGoalMin)})</option>
              {GOALS.map((g) => (
                <option key={g} value={g}>
                  {fmtHM(g)}
                </option>
              ))}
            </select>
          </Field>
          <Row g={10} className="g-ac">
            <span style={{ fontSize: 12.5, flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
              Remind me at
              <select className="g-input" style={{ width: 'auto', padding: '3px 6px' }} value={d.prefs.remindHour} disabled={busy} onChange={(e) => save({ remindHour: Number(e.target.value) })} aria-label="Reminder time">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h % 12 || 12}:00 {h < 12 ? 'AM' : 'PM'}
                  </option>
                ))}
              </select>
            </span>
            <Toggle on={d.prefs.remind} onChange={(v) => save({ remind: v })} label="Daily goal reminder" />
          </Row>
          <Row g={10} className="g-ac">
            <span style={{ fontSize: 12.5, flex: 1 }}>Alert me when my streak is at risk</span>
            <Toggle on={d.prefs.streakAlert} onChange={(v) => save({ streakAlert: v })} label="Streak alert" />
          </Row>
        </Card>

        <Card
          title="Activity heatmap"
          i="cal"
          sub="Active learning minutes per day · last 46 weeks"
          style={{ flex: 1 }}
          right={
            <Leg
              g={8}
              items={[
                ['0', HEAT[0]],
                ['<30m', HEAT[1]],
                ['30–60m', HEAT[2]],
                ['1–2h', HEAT[3]],
                ['2h+', HEAT[4]],
              ]}
            />
          }
        >
          <Heat days={d.heat} cell={12} />
          <Row g={10} className="g-rs">
            {[
              ['Active days', `${d.heatStats.activeDays} / ${d.heatStats.spanDays}`],
              ['Longest streak', `${d.heatStats.longest} days`],
              ['Most active', d.heatStats.mostActive],
              ['Idle time excluded', `${d.heatStats.idleYear} this year`],
            ].map(([a, b]) => (
              <Col key={a} g={2} style={{ flex: 1, background: C.bg, borderRadius: 10, padding: '10px 12px' }}>
                <span className="g-s11 g-mut">{a}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{b}</span>
              </Col>
            ))}
          </Row>
        </Card>
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title={range === 'day' ? 'Practice time today' : range === 'week' ? 'Practice time this week' : 'Practice time this month'}
          i="chart"
          sub={range === 'day' ? 'Hours per hour of the day' : `Hours per day · dashed line = daily goal (${fmtHM(d.goalMin)})`}
          style={{ flex: 1 }}
        >
          <Bars
            d={d.bars.values}
            w={680}
            h={170}
            max={Math.max(range === 'day' ? 1 : goalH * 1.5, ...d.bars.values, 0.5)}
            goal={range === 'day' ? undefined : goalH}
            xl={d.bars.xl}
            cf={(v) => (v === 0 ? C.ln : range !== 'day' && v >= goalH ? C.pri : '#67e8f9')}
            title="Practice hours"
          />
        </Card>
        <Card title="Where your time went" i="pie" sub={`Active time only · this ${range}`} style={{ width: 400, flexShrink: 0 }}>
          {WHERE.filter(([key]) => key !== 'live' || d.where.live).map(([key, ic, l, col]) => (
            <Row key={key} g={10} className="g-ac">
              <IB n={ic} box={30} s={15} bg={C.bg2} c={col} />
              <Col g={4} style={{ flex: 1 }}>
                <Row className="g-sb">
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{l}</span>
                  <b style={{ fontSize: 12.5 }}>{fmtHM((d.where[key] || 0) / 60)}</b>
                </Row>
                <Bar pct={((d.where[key] || 0) / totalWhere) * 100} col={col} />
              </Col>
            </Row>
          ))}
          <Note tone="mut" i="pause">
            Idle detection: {fmtHM(d.idleRange / 60)} not counted (no keyboard, mouse or video for {d.idleTimeoutMin} min).
          </Note>
        </Card>
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="Time per course, module & topic" i="layers" style={{ flex: 1 }}>
          <Table
            cols={[
              ['Course › Module › Topic', 'f'],
              ['Active time', 100],
              ['Completion', 150],
              ['Exercises', 90],
            ]}
            rows={d.tree.map((r) => [
              <span style={{ paddingLeft: r.level * 16, fontWeight: r.level === 0 ? 700 : r.level === 1 ? 600 : 400, fontSize: 12.5 }}>
                {r.level ? '› ' : ''}
                {r.name}
              </span>,
              r.time,
              r.completion == null ? (
                <span className="g-fa">—</span>
              ) : (
                <>
                  <Bar pct={r.completion} col={r.completion >= 100 ? C.ok : r.completion >= 50 ? C.wa : C.er} w={90} />
                  <span style={{ fontSize: 12 }}>{r.completion}%</span>
                </>
              ),
              r.exercises,
            ])}
            empty="No tracked learning yet — time shows up here as you study."
          />
        </Card>
        <Card title="Exercises & reminders" i="code" style={{ width: 400, flexShrink: 0 }}>
          <Row g={10}>
            {[
              ['Attempted', d.exercises.attempted, 'ind'],
              ['Completed', d.exercises.completed, 'ok'],
              ['Success rate', d.exercises.success == null ? '—' : `${d.exercises.success}%`, 'pri'],
            ].map(([a, b, t]) => (
              <Col key={a} g={2} style={{ flex: 1, background: C.bg, borderRadius: 10, padding: '10px 12px' }}>
                <span className="g-s11 g-mut">{a}</span>
                <span style={{ fontSize: 17, fontWeight: 700, color: TONE[t][1] }}>{b}</span>
              </Col>
            ))}
          </Row>
          <span className="g-s11 g-fa">Coding & output exercises · last 30 days</span>
          <Lbl>Reminders</Lbl>
          {d.reminders.length === 0 && <span className="g-s12 g-fa">Reminders are off.</span>}
          {d.reminders.map((r) => (
            <Row key={r.text} g={10} className="g-ac" style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
              <IB n={r.i} tone={r.tone} box={28} s={14} />
              <span style={{ fontSize: 12, flex: 1 }}>{r.text}</span>
            </Row>
          ))}
        </Card>
      </Row>
    </Screen>
  );
}
