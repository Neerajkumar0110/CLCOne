import React from 'react';
import api from './api';
import { C, TONE, Card, Table, Screen, useData } from './ui';

// Figma 2G "Status flow & automations" — the project state machine and the
// rules the system runs on its own, with how often each one ran (30 days).

const N = {
  al: [20, 120, 'Allocated', 'mut', 'timer starts'],
  ip: [220, 120, 'In Progress', 'sky', 'live countdown'],
  sb: [420, 120, 'Submitted', 'ind', 'timer stops'],
  ur: [620, 120, 'Under Review', 'pu', 'rubric scoring'],
  q: [880, 20, 'Qualified', 'ok', 'score ≥ pass'],
  nq: [880, 120, 'Not Qualified', 'or', 'score < pass'],
  dq: [880, 240, 'Disqualified', 'er', 'no submission'],
  ex: [220, 250, 'Extension requested', 'pk', 'mentor decides'],
  h: [1140, 20, 'Learner 360°', 'pri', 'project score'],
};
const W = 180;
const Hh = 64;
const mid = (n, s) => {
  const p = N[n];
  return s === 'r' ? [p[0] + W, p[1] + Hh / 2] : s === 'l' ? [p[0], p[1] + Hh / 2] : s === 't' ? [p[0] + W / 2, p[1]] : [p[0] + W / 2, p[1] + Hh];
};

const RULES = [
  ['Project allocated (or start date reached)', 'Start countdown, status Allocated → In Progress on first open', 'Learner (email + in-app), mentor', ['allocated', 'started']],
  ['48 h / 24 h / 1 h before deadline', 'Send reminder; timer turns amber → orange → red', 'Learner', ['reminder']],
  ['Learner submits', 'Stop timer, save time taken + timestamp, status Submitted', 'Mentor', ['submitted']],
  ['Deadline passes', 'Lock submission form for everyone not on extension', '—', ['locked']],
  ['Deadline passes with no submission', 'Status Disqualified automatically', 'Learner, mentor, support', ['disqualified']],
  ['Mentor publishes rubric score', '≥ passing → Qualified; < passing → Not Qualified (+ resubmit window if allowed)', 'Learner', ['result']],
  ['Extension approved', 'Move deadline, resume timer, reschedule reminders', 'Learner, support', ['extension']],
  ['Mentor overrides a status', 'Change status, write reason to audit log', 'Learner, admin', ['override']],
  ['Score finalised', 'Update Learner 360° project score → hire-readiness recalculates live', 'Learner', ['result', 'override']],
];

export default function StatusFlow() {
  const { data } = useData(() => api.projectAutomation(), []);
  const counts = (data && data.counts) || {};
  const ran = (kinds) => kinds.reduce((s, k) => s + ((counts[k] && counts[k].n) || 0), 0);
  const ln = (a, b, dash) => <path d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`} strokeDasharray={dash ? '6 5' : undefined} />;
  return (
    <Screen crumb="LMS / Projects / Automations" title="Status flow & automations">
      <Card>
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox="0 0 1376 330" style={{ width: '100%', minWidth: 900, height: 'auto', display: 'block' }} role="img" aria-label="Project status flow">
            <defs>
              <marker id="g-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0 0L8 4L0 8z" fill={C.fa} />
              </marker>
            </defs>
            <g fill="none" stroke={C.fa} strokeWidth="2" markerEnd="url(#g-arrow)">
              {ln(mid('al', 'r'), mid('ip', 'l'))}
              {ln(mid('ip', 'r'), mid('sb', 'l'))}
              {ln(mid('sb', 'r'), mid('ur', 'l'))}
              <path d="M800 152 L840 152 L840 52 L876 52" />
              <path d="M800 152 L876 152" />
              <path d="M300 120 L300 70 Q300 60 310 60 L860 60 Q870 60 870 70 L870 270 L876 272" strokeDasharray="6 5" />
              <path d="M1060 52 L1136 52" />
              <path d="M970 184 L970 214 Q970 224 960 224 L320 224 Q310 224 310 214 L310 188" strokeDasharray="6 5" />
              <path d="M970 304 L970 318 Q970 324 960 324 L120 324 Q110 324 110 314 L110 188" strokeDasharray="6 5" />
              {ln(mid('ip', 'b'), mid('ex', 't'))}
              <path d="M400 282 L420 282 L420 190 L400 178" strokeDasharray="6 5" />
            </g>
            {Object.entries(N).map(([key, [x, y, t, tone, sub]]) => (
              <g key={key}>
                <rect x={x} y={y} width={W} height={Hh} rx="12" fill={TONE[tone][0]} stroke={TONE[tone][1]} />
                <text x={x + 14} y={y + 28} fontSize="13.5" fontWeight="700" fill={TONE[tone][1]}>
                  {t}
                </text>
                <text x={x + 14} y={y + 46} fontSize="11" fill={TONE[tone][1]}>
                  {sub}
                </text>
              </g>
            ))}
            {[
              ['deadline passed, nothing submitted', 330, 54],
              ['resubmit (if allowed)', 560, 218],
              ['re-allocate', 480, 318],
              ['approved → new deadline', 430, 272],
            ].map(([t, x, y]) => (
              <text key={t} x={x} y={y} fontSize="11" fontWeight="600" fill={C.mut}>
                {t}
              </text>
            ))}
          </svg>
        </div>
      </Card>
      <Card title="Automation rules" i="zap" sub={data ? 'Runs on its own every minute · count = times it ran in the last 30 days' : ''}>
        <Table
          cols={[
            ['When', 'f'],
            ['System does', 520],
            ['Notified', 200],
            ['Ran (30 d)', 90],
          ]}
          rows={RULES.map(([w, d, n, kinds]) => [w, d, n, <b style={{ fontSize: 12.5 }}>{data ? ran(kinds) : '—'}</b>])}
        />
      </Card>
    </Screen>
  );
}
