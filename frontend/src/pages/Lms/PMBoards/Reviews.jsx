import React, { lazy, useEffect, useMemo, useState } from 'react';
import { Alert, message } from 'antd';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, fmtDay, shortName, errText } from './shared';

const Projects = lazy(() => import('../Projects'));

// P3 — project reviews: queue | latest submission (repo / deployment link
// check, files, documentation checklist, changes since the last version) |
// rubric with 1–10 buttons and the three decisions. Writes go through the
// existing review endpoint (decision + rubric scores + feedback + changes +
// checklist). The full Projects page (assign, edit, milestones…) is the
// "All projects" tab.

const DEFAULT_CHECKS = ['README with setup steps', 'API docs / endpoints', 'Sample output screenshots'];
const QUEUE = ['submitted', 'in_review'];
const stepsFor = (max) => Array.from({ length: 10 }, (_, i) => (max === 10 ? i + 1 : Math.round((max * (i + 1)) / 10)));

function ReviewPane({ id, onDone }) {
  const [scores, setScores] = useState({});
  const [checks, setChecks] = useState([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  const [links, setLinks] = useState(null);
  const { data: p, loading, error } = useLoad(async () => res(await lmsApi.getProject(id)), [id]);

  useEffect(() => {
    if (!p) return;
    const subs = p.submissions || [];
    const prev = subs.length > 1 ? subs[subs.length - 2].review : null;
    const labels = (prev && prev.checklist && prev.checklist.length ? prev.checklist.map((c) => c.label) : DEFAULT_CHECKS);
    setChecks(labels.map((label) => ({ label, done: !!(prev && prev.checklist && (prev.checklist.find((c) => c.label === label) || {}).done) })));
    setScores({});
    setComment('');
    setLinks(null);
    let alive = true;
    lmsApi
      .pmLinkCheck(id)
      .then((r) => alive && setLinks(res(r)))
      .catch(() => alive && setLinks({ error: true }));
    return () => {
      alive = false;
    };
  }, [p, id]);

  const rubric = useMemo(() => (p && p.rubric && p.rubric.length ? p.rubric : []), [p]);
  if (loading) return <Loading />;
  if (error || !p) return <Alert type="error" showIcon message={error || 'Not found.'} />;
  const subs = p.submissions || [];
  const last = subs[subs.length - 1];
  const prev = subs.length > 1 ? subs[subs.length - 2] : null;
  const max = rubric.reduce((a, r) => a + (r.maxMarks || 0), 0);
  const total = rubric.reduce((a, r) => a + (scores[r.criterion] || 0), 0);
  const allScored = rubric.every((r) => scores[r.criterion] != null);
  const ms = (p.milestones || []).findIndex((m) => m.status !== 'done');

  const decide = async (decision) => {
    if (decision === 'approved' && rubric.length && !allScored) return message.warning('Score every rubric criterion before approving.');
    if (decision !== 'approved' && !comment.trim()) return message.warning('Say in the comment what needs to change.');
    setBusy(decision);
    try {
      const r = await lmsApi.reviewProject(id, {
        decision,
        feedback: comment.trim(),
        changes: decision === 'revision_requested' ? comment : '',
        rubricScores: rubric.filter((c) => scores[c.criterion] != null).map((c) => ({ criterion: c.criterion, marks: scores[c.criterion] })),
        checklist: checks,
      });
      if (r && r.success === false) throw new Error(r.message);
      message.success(decision === 'approved' ? 'Milestone approved — learner notified.' : decision === 'rejected' ? 'Marked not approved.' : 'Changes requested — learner notified.');
      onDone();
    } catch (e) {
      message.error(errText(e, 'Review failed.'));
    } finally {
      setBusy('');
    }
  };

  const linkRow = (label, url, check) => (
    <div className="ld-li">
      <span>{label}</span>
      <span>
        {url ? <a href={url} target="_blank" rel="noreferrer">{String(url).replace(/^https?:\/\//, '').slice(0, 48)}</a> : <span className="ld-muted">not provided</span>}{' '}
        {url && (links ? check ? <b style={{ color: check.ok ? '#166534' : '#991b1b' }}>{check.ok && /github/i.test(url) ? 'reachable' : check.label}</b> : null : <span className="ld-muted">checking…</span>)}
      </span>
    </div>
  );

  return (
    <>
      <section className="ld-card" aria-label="Submission">
        <div className="ld-hd">
          <b>{last ? `Submission v${last.version}` : 'No submission yet'}{ms >= 0 ? ` · Milestone ${ms + 1} · ${p.milestones[ms].title}` : ''}</b>
          {last && <span className="ld-chip naya">v{last.version} of {subs.length}</span>}
        </div>
        <div className="ld-muted" style={{ fontSize: 13 }}>{p.studentName} · {p.title}{last ? ` · ${fmtDay(last.submittedAt)}` : ''}</div>
        {last && (
          <>
            {linkRow('Repo', last.githubUrl || p.githubUrl, links && links.repo)}
            {linkRow('Deployment', last.deploymentUrl || p.deploymentUrl, links && links.deploy)}
            <div className="ld-li">
              <span>Files</span>
              <span>{(last.files || []).length ? last.files.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>{f.name}</a>) : <span className="ld-muted">none</span>}</span>
            </div>
            <div className="ld-li"><span>Demo video</span>{last.demoUrl ? <a href={last.demoUrl} target="_blank" rel="noreferrer">Open</a> : <span className="ld-muted">not provided</span>}</div>
            {last.note && <div className="ld-soft">{last.note}</div>}
          </>
        )}
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Documentation checklist</div>
        {checks.map((c, i) => (
          <label key={c.label} className="pm-check">
            <input type="checkbox" checked={c.done} onChange={(e) => setChecks(checks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} /> {c.label}
          </label>
        ))}
        {prev && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Changes since v{prev.version}</div>
            <div className="ld-soft">
              {(prev.review && prev.review.changes && prev.review.changes.length ? prev.review.changes : prev.review && prev.review.feedback ? [prev.review.feedback] : ['No changes were requested on v' + prev.version]).map((c, i) => (
                <div key={i}>○ {c}</div>
              ))}
            </div>
          </>
        )}
        <div className="ld-muted" style={{ fontSize: 12, marginTop: 'auto' }}>A learner's code is never executed on the production server · secrets are never asked for in fields</div>
      </section>

      <section className="ld-card" aria-label="Rubric">
        <div className="ld-hd"><b>Rubric</b><span style={{ fontSize: 18, fontWeight: 700 }}>{total}<span className="ld-muted" style={{ fontSize: 13 }}> / {max}</span></span></div>
        {rubric.length === 0 && <div className="ld-empty">No rubric is set for this project.</div>}
        {rubric.map((c) => (
          <div key={c.criterion} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="ld-hd"><span style={{ fontSize: 13, fontWeight: 600 }}>{c.criterion}</span><b style={{ fontSize: 13 }}>{scores[c.criterion] != null ? scores[c.criterion] : '–'}/{c.maxMarks}</b></div>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {stepsFor(c.maxMarks || 10).map((n) => (
                <button key={n} type="button" className={`ld-sc${scores[c.criterion] === n ? ' on' : ''}`} aria-label={`${c.criterion} ${n}`} onClick={() => setScores({ ...scores, [c.criterion]: n })}>{n}</button>
              ))}
            </div>
          </div>
        ))}
        <textarea className="ld-inp" aria-label="Review comment" style={{ height: 64, padding: 8, resize: 'none' }} placeholder="Ranking logic is solid. Add sample output screenshots, then approve." value={comment} onChange={(e) => setComment(e.target.value)} />
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
          <button type="button" className="ld-btn2" disabled={!last || !!busy} onClick={() => decide('rejected')}>Not approved</button>
          <button type="button" className="ld-btn2" disabled={!last || !!busy} onClick={() => decide('revision_requested')}>Request changes</button>
          <button type="button" className="ld-btn" disabled={!last || !!busy} onClick={() => decide('approved')}>{busy === 'approved' ? 'Saving…' : 'Approve milestone'}</button>
        </div>
        <div className="ld-muted" style={{ fontSize: 12 }}>Approve → eligibility recalculated · approver + reason in the audit log</div>
      </section>
    </>
  );
}

function ReviewBoard() {
  const wanted = (() => {
    try {
      return new URLSearchParams(window.location.search).get('review');
    } catch (e) {
      return null;
    }
  })();
  const [sel, setSel] = useState(wanted);
  const { data, loading, error, reload } = useLoad(async () => res(await lmsApi.teacherProjects()) || [], []);
  const now = new Date();
  const queue = (data || [])
    .filter((p) => QUEUE.includes(p.status) || p.id === wanted)
    .sort((a, b) => new Date(a.updated) - new Date(b.updated));
  useEffect(() => {
    if (!sel && queue.length) setSel(queue[0].id);
  }, [queue, sel]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} />;

  return (
    <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '260px 1fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
      <section className="ld-card pm-scroll" style={{ gap: 8 }} aria-label="Queue">
        <b style={{ fontSize: 14 }}>Queue · {queue.length}</b>
        {queue.length === 0 && <div className="ld-empty">Sab reviews ho gaye 🎉</div>}
        {queue.map((p) => {
          const late = p.dueDate && new Date(p.dueDate) < now ? Math.floor((now - new Date(p.dueDate)) / 86400000) : 0;
          return (
            <button key={p.id} type="button" className={`ld-qi${sel === p.id ? ' on' : ''}`} onClick={() => setSel(p.id)}>
              <b>{shortName(p.student)} · {p.title}</b>
              {late ? <span style={{ color: '#991b1b' }}>v{p.currentVersion || 1} · {late} day{late > 1 ? 's' : ''} late</span> : <span className="ld-muted">v{p.currentVersion || 1}{p.currentVersion > 1 ? ' · resubmitted' : ''} · {fmtDay(p.updated)}</span>}
            </button>
          );
        })}
      </section>
      {sel ? (
        <ReviewPane
          key={sel}
          id={sel}
          onDone={() => {
            setSel(null);
            reload();
          }}
        />
      ) : (
        <section className="ld-card" style={{ gridColumn: 'span 2' }}><div className="ld-empty">Pick a submission from the queue.</div></section>
      )}
    </div>
  );
}

export default function PMReviews() {
  const [tab, setTab] = useTab('reviews');
  return (
    <PMPage title="Project reviews" right={<PMTabs tabs={[['reviews', 'Review queue'], ['all', 'All projects']]} value={tab} onChange={setTab} />}>
      {tab === 'reviews' ? <ReviewBoard /> : <Legacy><Projects /></Legacy>}
    </PMPage>
  );
}
