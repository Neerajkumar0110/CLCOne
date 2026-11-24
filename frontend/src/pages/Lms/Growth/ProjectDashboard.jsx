import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, Chip, Btn, Av, Card, Row, Col, KPI, Table, Donut, Screen, Loading, ErrorBox, useData } from './ui';
import { StatusChip, statusOf, TimePill, useNow } from './projectsShared';

// Figma 2D "Project dashboard" (Mentor; Admin sees every batch). Live —
// refreshed every minute.

const MIX = [
  ['allocated', 'Allocated', C.fa],
  ['in_progress', 'In progress', C.sky],
  ['submitted', 'Submitted', C.ind],
  ['under_review', 'In review', C.pu],
  ['qualified', 'Qualified', C.ok],
  ['not_qualified', 'Not qual.', C.or],
  ['disqualified', 'Disqual.', C.er],
  ['extension', 'Extension', C.pk],
];

function actionFor(a) {
  const s = statusOf(a);
  if (s === 'extension') return ['Decide', 'i'];
  if (s === 'submitted' || s === 'under_review') return ['Review', 'i'];
  if (s === 'disqualified') return ['Re-allocate', 'd'];
  if (s === 'allocated' || s === 'in_progress') return ['Remind', 'g'];
  return ['View', 'g'];
}
const subText = (a) => {
  if (a.submission) {
    const p = [a.submission.githubUrl && 'GitHub', a.submission.demoUrl && 'demo', a.submission.files && a.submission.files.length && 'files'].filter(Boolean).join(' · ');
    return a.submission.version > 1 ? `v${a.submission.version} · resubmitted` : p || 'Submitted';
  }
  if (a.status === 'disqualified') return 'No submission';
  if (a.draft && a.draft.savedAt) return 'Draft saved';
  return a.startedAt ? 'Not submitted' : 'Not started';
};

export default function ProjectDashboard({ go }) {
  const [flt, setFlt] = useState({ batch: '', brief: '', status: '', due: '' });
  const { data, error, loading, reload } = useData(() => api.projectDashboard(flt), [flt.batch, flt.brief, flt.status, flt.due]);
  const now = useNow(data && data.serverNow);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const iv = setInterval(reload, 60000);
    return () => clearInterval(iv);
  }, [reload]);
  if (loading && !data) return <Loading text="Loading projects…" />;
  if (error) return <ErrorBox text={error} />;
  const k = data.kpis;
  const total = Object.entries(data.mix)
    .filter(([s]) => s !== 'extension')
    .reduce((s, [, n]) => s + n, 0);

  const act = async (a) => {
    const [l] = actionFor(a);
    if (l === 'Remind') {
      setBusy(true);
      const r = await api.remind(a.id);
      setBusy(false);
      return r.success ? message.success(r.message) : message.error(r.message);
    }
    go('review', a.id);
  };
  const decide = async (a, decision) => {
    setBusy(true);
    const r = await api.decideExtension(a.id, { decision, days: a.extension.days });
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
    } else message.error(r.message);
  };
  const exportCsv = () => {
    const head = ['Learner', 'Group', 'Project', 'Batch', 'Status', 'Deadline', 'Submitted', 'Score'];
    const body = data.rows.map((a) => [a.learnerName, a.groupName || '', a.title, a.batch, statusOf(a), a.deadline, a.submittedAt || '', a.review && a.review.published ? a.review.score : '']);
    const text = [head, ...body].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    el.download = 'project-allocations.csv';
    el.click();
  };
  const sel = (key, label, ic, opts) => (
    <div className="g-input" style={{ width: 'auto', padding: '6px 10px' }}>
      <select value={flt[key]} onChange={(e) => setFlt({ ...flt, [key]: e.target.value })} aria-label={label} style={{ fontSize: 12, fontWeight: 600 }}>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {label}: {l}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Screen
      crumb="LMS / Projects"
      title="Projects · all learners"
      actions={
        <Btn k="p" i="plus" onClick={() => go('create')}>
          New project
        </Btn>
      }
    >
      <Row className="g-rs">
        <KPI i="folder" label="Active projects" val={k.activeProjects} sub={`${k.allocations} allocations`} tone="ind" style={{ flex: 1 }} />
        <KPI i="edit" label="Awaiting review" val={k.awaitingReview} sub={k.oldestDays != null ? `oldest ${k.oldestDays} day${k.oldestDays === 1 ? '' : 's'}` : 'none waiting'} tone="pu" style={{ flex: 1 }} />
        <KPI i="timer" label="Due in 24 h" val={k.due24} sub="reminders sent automatically" tone="or" style={{ flex: 1 }} />
        <KPI i="x" label="Disqualified" val={k.disqualified} sub="no submission" tone="er" style={{ flex: 1 }} />
        <KPI i="checkc" label="Qualification rate" val={k.qualificationRate == null ? '—' : `${k.qualificationRate}%`} sub="of decided projects" tone="ok" bar={k.qualificationRate || 0} style={{ flex: 1 }} />
      </Row>

      <Row g={10} className="g-ac g-wrap">
        {sel('batch', 'Batch', 'layers', [['', 'All'], ...data.batches.map((b) => [b, b])])}
        {sel('brief', 'Project', 'folder', [['', 'All'], ...data.briefs.map((b) => [b.id, b.title])])}
        {sel('status', 'Status', 'flag', [['', 'All'], ...MIX.map(([v, l]) => [v, l])])}
        {sel('due', 'Deadline', 'cal', [
          ['', 'Any'],
          ['1', 'next 24 h'],
          ['3', 'next 3 days'],
          ['7', 'next 7 days'],
        ])}
        <span style={{ flex: 1 }} />
        <Btn k="g" sm i="download" onClick={exportCsv} disabled={!data.rows.length}>
          Export CSV
        </Btn>
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="Allocations" i="list" sub="Live · refreshed every minute" style={{ flex: 1 }}>
          <Table
            cols={[
              ['Learner', 'f'],
              ['Project', 160],
              ['Status', 150],
              ['Time left', 140],
              ['Submission', 130],
              ['Score', 50],
              ['', 100],
            ]}
            rows={data.rows.map((a) => {
              const [l, kk] = actionFor(a);
              return [
                <>
                  <Av name={a.groupName || a.learnerName} s={24} />
                  <span style={{ fontSize: 12.5, fontWeight: 500 }} title={a.memberNames.join(', ')}>
                    {a.groupName ? `${a.groupName} · ${a.memberNames.length}` : a.learnerName}
                  </span>
                </>,
                a.title,
                <StatusChip a={a} />,
                <TimePill a={a} now={now} />,
                subText(a),
                <b style={{ fontSize: 12.5 }}>{a.review && a.review.published ? a.review.score : a.status === 'disqualified' ? '0' : '—'}</b>,
                <Btn k={kk} sm onClick={() => act(a)} disabled={busy}>
                  {l}
                </Btn>,
              ];
            })}
            empty="No allocations match. Create a project and allocate it."
          />
        </Card>

        <Col style={{ width: 300, flexShrink: 0 }}>
          <Card title="Status mix" i="pie">
            <Row g={12} className="g-ac">
              <Donut segs={MIX.map(([s, , c]) => ({ v: data.mix[s] || 0, c }))} s={110} center={String(total)} cl="total" />
              <Col g={4} style={{ width: 'auto' }}>
                {MIX.map(([s, l, c]) => (
                  <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.sub }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
                    {l} {data.mix[s] || 0}
                  </span>
                ))}
              </Col>
            </Row>
          </Card>
          <Card title="Extension requests" i="clock" sub="Mentor decides · support can nudge">
            {data.extensions.length === 0 && <span className="g-s12 g-fa">No pending requests.</span>}
            {data.extensions.map((a) => (
              <Col key={a.id} g={6} style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
                <Row className="g-sb g-ac">
                  <b style={{ fontSize: 12.5 }}>{a.learnerName}</b>
                  <Chip tone="pk" s={10.5}>
                    +{a.extension.days} day{a.extension.days === 1 ? '' : 's'}
                  </Chip>
                </Row>
                <span className="g-s12 g-mut">
                  {a.title} · {a.extension.reason}
                </span>
                {(a.extension.nudges || []).length > 0 && <span className="g-s11" style={{ color: C.pu }}>Support nudged {a.extension.nudges.length}×</span>}
                <Row g={6}>
                  <Btn k="ok" sm i="check" onClick={() => decide(a, 'approve')} disabled={busy}>
                    Approve
                  </Btn>
                  <Btn k="d" sm i="x" onClick={() => decide(a, 'reject')} disabled={busy}>
                    Reject
                  </Btn>
                </Row>
              </Col>
            ))}
          </Card>
          <Card title="Projects" i="folder" sub="Edit or allocate again">
            {data.briefs.filter((b) => b.status !== 'archived').length === 0 && <span className="g-s12 g-fa">No projects yet.</span>}
            {data.briefs
              .filter((b) => b.status !== 'archived')
              .slice(0, 12)
              .map((b) => (
                <Row key={b.id} g={6} className="g-ac">
                  <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={b.title}>
                    {b.title}
                  </span>
                  {b.status === 'draft' && <Chip s={10}>Draft</Chip>}
                  <Btn k="g" sm onClick={() => go('edit', b.id)}>
                    Edit
                  </Btn>
                  <Btn k="s" sm onClick={() => go('allocate', b.id)}>
                    Allocate
                  </Btn>
                </Row>
              ))}
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}
