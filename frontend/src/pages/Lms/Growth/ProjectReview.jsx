import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, IB, Chip, Btn, Av, Card, Row, Col, Field, Table, Tabs, Slider, Toggle, Lbl, Note, Screen, Loading, ErrorBox, useData } from './ui';
import { StatusChip, STATUS, fmtDT, fmtShort, toLocalInput, dhm, useNow } from './projectsShared';

// Figma 2E "Review submission & decide" (Mentor / Admin).

const STATUS_OPTS = ['allocated', 'in_progress', 'submitted', 'under_review', 'qualified', 'not_qualified', 'disqualified'];

// public GitHub repo → commit count (best effort, no token)
function useCommits(url) {
  const [n, setN] = useState(null);
  useEffect(() => {
    const m = /github\.com\/([^/]+)\/([^/#?]+)/i.exec(url || '');
    if (!m) return setN(null);
    let alive = true;
    fetch(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}/commits?per_page=1`)
      .then((r) => {
        if (!r.ok) throw new Error('x');
        const link = r.headers.get('link') || '';
        const last = /page=(\d+)>; rel="last"/.exec(link);
        return last ? Number(last[1]) : r.json().then((j) => (Array.isArray(j) ? j.length : null));
      })
      .then((v) => alive && setN(v))
      .catch(() => alive && setN(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return n;
}

export default function ProjectReview({ id, onBack }) {
  const { data: a, error, loading, reload } = useData(() => api.alloc(id), [id]);
  const now = useNow(a && a.serverNow);
  const [ver, setVer] = useState(null);
  const [scores, setScores] = useState({});
  const [feedback, setFeedback] = useState('');
  const [ov, setOv] = useState({ status: '', reason: '' });
  const [rs, setRs] = useState({ allow: true, deadline: '' });
  const [ra, setRa] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!a) return;
    const rub = (a.brief && a.brief.rubric) || [];
    const given = new Map(((a.review && a.review.scores) || []).map((s) => [s.criterion, s.score]));
    setScores(Object.fromEntries(rub.map((r) => [r.criterion, given.has(r.criterion) ? given.get(r.criterion) : 0])));
    setFeedback((a.review && a.review.feedback) || '');
    setOv({ status: a.status === 'qualified' ? 'not_qualified' : 'qualified', reason: '' });
    setRs({ allow: a.resubmit ? !!a.resubmit.allowed || a.status === 'not_qualified' : true, deadline: toLocalInput((a.resubmit && a.resubmit.deadline) || new Date(Date.now() + 3 * 86400000)) });
    setRa(toLocalInput(new Date(Date.now() + 7 * 86400000)));
    setVer((a.submissions || []).length ? a.submissions[a.submissions.length - 1].version : null);
  }, [a]);
  const sub = a && (a.submissions || []).find((s) => s.version === ver);
  const commits = useCommits(sub && sub.githubUrl);

  if (loading && !a) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  if (!a) return null;
  const b = a.brief || {};
  const rub = b.rubric || [];
  const max = rub.reduce((s, r) => s + r.max, 0) || 100;
  const total = Math.round((rub.reduce((s, r) => s + (Number(scores[r.criterion]) || 0), 0) / max) * 100);
  const pass = b.passScore || 60;
  const q = total >= pass;
  const who = a.groupName ? `${a.groupName} (${a.memberNames.join(', ')})` : a.learnerName;

  const run = async (fn, ok) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.success) {
      message.success(r.message || ok);
      reload();
    } else message.error(r.message);
  };
  const reviewBody = (publish) => ({ scores: rub.map((r) => ({ criterion: r.criterion, score: Number(scores[r.criterion]) || 0 })), feedback, publish });
  const early = sub ? new Date(a.deadline) - new Date(sub.at) : null;

  return (
    <Screen
      crumb={`LMS / Reviews / ${a.title}`}
      title={`Review · ${who} — ${a.title}`}
      actions={
        <>
          <StatusChip a={a} />
          {onBack && (
            <Btn k="g" onClick={onBack}>
              Back to projects
            </Btn>
          )}
        </>
      }
    >
      {a.extension && a.extension.status === 'pending' && (
        <Card title="Extension request" i="clock" tone="pk" sub={`${a.learnerName} asks for +${a.extension.days} day(s) · ${fmtDT(a.extension.requestedAt)}`}>
          <span style={{ fontSize: 12.5, color: C.sub }}>“{a.extension.reason}” · current deadline {fmtDT(a.deadline)}</span>
          <Row g={8}>
            <Btn k="ok" i="check" disabled={busy} onClick={() => run(() => api.decideExtension(a.id, { decision: 'approve', days: a.extension.days }))}>
              Approve +{a.extension.days} d
            </Btn>
            <Btn k="d" i="x" disabled={busy} onClick={() => run(() => api.decideExtension(a.id, { decision: 'reject' }))}>
              Reject
            </Btn>
          </Row>
        </Card>
      )}
      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Col>
          <Card
            title="Submission"
            i="upload"
            right={
              (a.submissions || []).length > 0 && (
                <Tabs items={a.submissions.map((s) => [s.version, `v${s.version} · ${fmtShort(s.at)}`])} act={ver} onChange={setVer} />
              )
            }
          >
            {!sub ? (
              <Note tone="mut" i="clock">
                Nothing submitted yet · {a.startedAt ? `started ${fmtDT(a.startedAt)}` : 'not opened yet'} · deadline {fmtDT(a.deadline)}
              </Note>
            ) : (
              <>
                <Row g={10} className="g-rm">
                  {[
                    ['git', 'GitHub', sub.githubUrl],
                    ['globe', 'Live demo', sub.demoUrl],
                    ['file', 'Report', sub.files && sub.files[0] ? sub.files[0].url : null, sub.files && sub.files[0] ? sub.files[0].name : null],
                  ].map(([ic, l, href, name]) => (
                    <Row key={l} g={10} className="g-ac" style={{ flex: 1, background: C.bg, borderRadius: 10, padding: 12 }}>
                      <IB n={ic} box={30} s={15} />
                      <Col g={0} style={{ minWidth: 0 }}>
                        <span className="g-s11 g-mut">{l}</span>
                        {href ? (
                          <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: C.pri, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name || href.replace(/^https?:\/\//, '')}
                          </a>
                        ) : (
                          <span className="g-s125 g-fa">not given</span>
                        )}
                      </Col>
                    </Row>
                  ))}
                </Row>
                {sub.files && sub.files.length > 1 && (
                  <Row g={8} className="g-wrap">
                    {sub.files.slice(1).map((x) => (
                      <Btn key={x.url} k="s" sm i="download" href={x.url} target="_blank">
                        {x.name}
                      </Btn>
                    ))}
                  </Row>
                )}
                <Row g={10} className="g-rs">
                  {[
                    ['Submitted', new Date(sub.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })],
                    ['Time taken', a.timeTakenMs ? dhm(a.timeTakenMs) : '—'],
                    [early >= 0 ? 'Before deadline' : 'After deadline', early == null ? '—' : `${dhm(Math.abs(early)).replace(/^0d /, '')} ${early >= 0 ? 'early' : 'late'}`],
                    ['Commits', commits == null ? (sub.githubUrl ? 'private / unknown' : '—') : String(commits)],
                  ].map(([k, v]) => (
                    <Col key={k} g={2} style={{ flex: 1, background: C.bg, borderRadius: 10, padding: '10px 12px' }}>
                      <span className="g-s11 g-mut">{k}</span>
                      <b style={{ fontSize: 13 }}>{v}</b>
                    </Col>
                  ))}
                </Row>
                {sub.note && <span style={{ fontSize: 12.5, color: C.sub }}>Learner note: {sub.note}</span>}
              </>
            )}
          </Card>

          <Card title="Rubric scoring" i="list" sub={`Passing score ${pass} / 100`}>
            <Table
              cols={[
                ['Criterion', 'f'],
                ['Score', 230],
                ['Points', 80],
              ]}
              rows={rub.map((r) => [
                <span title={r.lookFor}>{r.criterion}</span>,
                <div style={{ width: 210 }}>
                  <Slider value={Number(scores[r.criterion]) || 0} max={r.max} col={C.ind} onChange={(v) => setScores({ ...scores, [r.criterion]: v })} label={`${r.criterion} score`} />
                </div>,
                <b style={{ fontSize: 12.5 }}>
                  {scores[r.criterion] || 0} / {r.max}
                </b>,
              ])}
            />
            <Row g={14} className="g-ac" style={{ background: q ? C.okL : C.orL, borderRadius: 12, padding: 14 }}>
              <IB n={q ? 'checkc' : 'alert'} bg={q ? C.ok : C.or} c={C.w} box={40} s={20} />
              <Col g={0}>
                <span style={{ fontSize: 17, fontWeight: 700, color: q ? C.okD : C.or }}>
                  {total} / 100 → {q ? 'Qualified' : 'Not Qualified'}
                </span>
                <span style={{ fontSize: 12, color: q ? C.okD : C.or }}>
                  {q ? `At or above passing score ${pass}` : `Below passing score ${pass}`} · will update Learner 360° project score
                </span>
              </Col>
            </Row>
            <Field label="Feedback to learner" htmlFor="rv-fb">
              <textarea id="rv-fb" className="g-input" rows={3} style={{ minHeight: 60 }} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What was good, what to improve…" />
            </Field>
            {a.review && a.review.published && (
              <Note tone="ok" i="checkc">
                Published {fmtDT(a.review.at)} by {a.review.byName} — {a.review.score} / 100. Publishing again replaces it.
              </Note>
            )}
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="s" disabled={busy || !sub} onClick={() => run(() => api.review(a.id, reviewBody(false)), 'Draft saved')}>
                Save draft
              </Btn>
              <Btn k="p" i="send" disabled={busy || !sub} onClick={() => run(() => api.review(a.id, reviewBody(true)))}>
                Publish result
              </Btn>
            </Row>
          </Card>
        </Col>

        <Col style={{ width: 400, flexShrink: 0 }}>
          <Card title="Override status" i="edit" sub="Every override is logged with reason">
            <Field label="New status" htmlFor="ov-st">
              <select id="ov-st" className="g-input" value={ov.status} onChange={(e) => setOv({ ...ov, status: e.target.value })}>
                {STATUS_OPTS.filter((s) => s !== a.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s][0]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reason (required)" htmlFor="ov-r">
              <textarea id="ov-r" className="g-input" rows={2} style={{ minHeight: 56 }} value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} placeholder="e.g. technical issue on submission portal verified by support" />
            </Field>
            <span>
              <Btn k="i" i="check" disabled={busy || ov.reason.trim().length < 5} onClick={() => run(() => api.override(a.id, ov))}>
                Apply override
              </Btn>
            </span>
            <Lbl>Audit log</Lbl>
            {(a.audit || []).length === 0 && <span className="g-s12 g-fa">No changes yet.</span>}
            {[...(a.audit || [])].reverse().map((x, i) => (
              <Row key={i} g={8} className="g-ac">
                <Chip s={10}>{new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</Chip>
                <span style={{ fontSize: 11.5, color: C.sub, flex: 1 }}>
                  {(STATUS[x.from] || [x.from])[0]} → {(STATUS[x.to] || [x.to])[0]}
                  {x.reason ? ` (${x.reason})` : ''}
                </span>
                <span className="g-s11 g-fa">{x.byName}</span>
              </Row>
            ))}
          </Card>

          {a.status === 'not_qualified' && (
            <Card title="Not Qualified options" i="refresh">
              <Row g={10} className="g-ac">
                <span style={{ fontSize: 12.5, flex: 1 }}>Allow resubmission ({Math.max(1, (a.resubmit && a.resubmit.left) || 0)} left)</span>
                <Toggle on={rs.allow} onChange={(v) => setRs({ ...rs, allow: v })} label="Allow resubmission" />
              </Row>
              <Field label="Resubmission deadline" htmlFor="rs-dl">
                <input id="rs-dl" type="datetime-local" className="g-input" value={rs.deadline} disabled={!rs.allow} onChange={(e) => setRs({ ...rs, deadline: e.target.value })} />
              </Field>
              <span>
                <Btn k="s" i="check" disabled={busy} onClick={() => run(() => api.resubmit(a.id, { allow: rs.allow, deadline: rs.deadline ? new Date(rs.deadline) : null }))}>
                  Save
                </Btn>
              </span>
            </Card>
          )}

          {['disqualified', 'not_qualified'].includes(a.status) && (
            <Card title={a.status === 'disqualified' ? 'Re-allocate disqualified learner' : 'Re-allocate (fresh attempt)'} i="undo">
              <Row g={10} className="g-ac">
                <Av name={a.learnerName} col={C.er} s={30} />
                <Col g={0}>
                  <b style={{ fontSize: 12.5 }}>
                    {who} · {a.title}
                  </b>
                  <span style={{ fontSize: 11.5, color: C.erD }}>
                    {a.status === 'disqualified' ? `Disqualified · no submission by ${fmtShort(a.deadline)}` : `Not Qualified · ${a.review ? a.review.score : '—'} / 100`}
                  </span>
                </Col>
              </Row>
              {a.reallocation && a.reallocation.status === 'requested' && (
                <Note tone="ind" i="undo">
                  Support ({a.reallocation.requestedByName}) asked to re-allocate{a.reallocation.note ? `: ${a.reallocation.note}` : ''}.
                </Note>
              )}
              <Field label="New deadline" htmlFor="ra-dl">
                <input id="ra-dl" type="datetime-local" className="g-input" value={ra} onChange={(e) => setRa(e.target.value)} />
              </Field>
              <span>
                <Btn k="s" i="refresh" disabled={busy || !ra} onClick={() => run(() => api.reallocate(a.id, { deadline: new Date(ra) }))}>
                  Re-allocate &amp; restart timer
                </Btn>
              </span>
            </Card>
          )}

          <Card title="Learner timeline" i="clock">
            <span className="g-s12 g-mut">Time left now: {['allocated', 'in_progress'].includes(a.status) ? dhm(Math.max(0, new Date(a.deadline) - now)) : '—'}</span>
            {[...(a.timeline || [])]
              .reverse()
              .slice(0, 8)
              .map((e, i) => (
                <Row key={i} g={8} className="g-ac">
                  <Chip s={10}>{fmtShort(e.at)}</Chip>
                  <span style={{ fontSize: 11.5, color: C.sub, flex: 1 }}>{e.text}</span>
                </Row>
              ))}
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}
