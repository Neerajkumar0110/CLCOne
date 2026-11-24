import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import { getSocket } from '@/socket';
import api from './api';
import { C, TONE, I, IB, Chip, Btn, Bar, Card, Row, Col, Field, Steps, Check, Note, Lbl, Timer, Screen, Loading, ErrorBox, useData, timerTone, splitMs } from './ui';
import { STATUS, StatusChip, statusOf, useNow, fmtDT, fmtShort, kb, fileTone, timerOf } from './projectsShared';

// Figma 2C "My project · live timer & submission" (Learner).

const STEP_OF = { allocated: 0, in_progress: 1, submitted: 2, under_review: 3, qualified: 4, not_qualified: 4, disqualified: 4 };
const LEVEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };

function ProjectView({ id, others, onPick, reloadList }) {
  const { data: a, error, loading, reload } = useData(() => api.alloc(id), [id]);
  const now = useNow(a && a.serverNow, 15000);
  const [f, setF] = useState({ githubUrl: '', demoUrl: '', note: '', files: [] });
  const [ext, setExt] = useState({ days: 2, reason: '' });
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!a) return;
    const src = (a.draft && a.draft.savedAt ? a.draft : null) || a.submission || {};
    setF({ githubUrl: src.githubUrl || '', demoUrl: src.demoUrl || '', note: src.note || '', files: src.files || [] });
  }, [a]);
  useEffect(() => {
    const s = getSocket();
    const on = (n) => n && n.module === 'LMS' && reload();
    s?.on('notification:new', on);
    return () => s?.off('notification:new', on);
  }, [reload]);

  if (loading && !a) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  if (!a) return null;
  const b = a.brief || {};
  const t = timerOf(a, now);
  const left = new Date(a.deadline) - now;
  const [tone, toneLabel] = t.stopped ? ['mut', 'Stopped · time taken'] : t.notStarted ? ['mut', 'Starts in'] : timerTone(left, false);
  const parts = splitMs(t.stopped ? a.timeTakenMs || 0 : Math.max(0, t.ms));
  const resubmitting = a.status === 'not_qualified' && a.resubmit && a.resubmit.allowed && new Date(a.resubmit.deadline) > now;
  const canSubmit = !a.locked || resubmitting;
  const nextRem = ['h48', 'h24', 'h1'].filter((k) => !(a.remindersSent || {})[k]).map((k) => ({ h48: '48 h', h24: '24 h', h1: '1 h' })[k]);
  const sentRem = ['h48', 'h24', 'h1'].filter((k) => (a.remindersSent || {})[k]).map((k) => ({ h48: '48 h', h24: '24 h', h1: '1 h' })[k]);
  const stepSub = [fmtShort(a.allocatedAt), a.startedAt ? `started ${fmtShort(a.startedAt)}` : '', a.submittedAt ? fmtShort(a.submittedAt) : '', a.review && a.review.at && !a.review.published ? 'in review' : '', a.review && a.review.published ? `${a.review.score} / 100` : a.status === 'disqualified' ? 'Disqualified' : ''];
  const maxR = Math.max(1, ...(b.rubric || []).map((r) => r.max));

  const saveDraft = async (extra = {}) => {
    const r = await api.saveDraft(a.id, { ...f, ...extra });
    if (r.success) {
      if (!extra.deliverablesDone) message.success('Draft saved');
      reload();
    } else message.error(r.message);
  };
  const submit = async () => {
    setBusy(true);
    const r = await api.submitProject(a.id, f);
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
      reloadList();
    } else message.error(r.message);
  };
  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    setUp(true);
    const added = [];
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        message.error(`${file.name} is over 50 MB`);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const r = await api.uploadProjectFile(file);
      if (r.success) added.push(r.result);
      else message.error(r.message);
    }
    setUp(false);
    if (added.length) setF({ ...f, files: [...f.files, ...added] });
  };
  const askExt = async () => {
    setBusy(true);
    const r = await api.askExtension(a.id, ext);
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      setExt({ days: 2, reason: '' });
      reload();
    } else message.error(r.message);
  };
  const toggleDel = (i, v) => {
    const d = (b.deliverables || []).map((_, j) => (j === i ? v : !!(a.deliverablesDone || [])[j]));
    saveDraft({ deliverablesDone: d });
  };

  return (
    <Screen crumb={`LMS / Projects / ${a.title}`} title={a.title}>
      <Row className="g-rm" style={{ alignItems: 'center' }}>
        <Card p={22} g={12} style={{ flex: 1 }}>
          <Row g={8} className="g-ac g-wrap">
            <StatusChip a={a} />
            {a.difficulty && <Chip>{LEVEL[a.difficulty] || a.difficulty}</Chip>}
            {a.groupName && (
              <Chip tone="ind" i="users">
                {a.groupName}
              </Chip>
            )}
          </Row>
          <span style={{ fontSize: 22, fontWeight: 700 }}>{a.title}</span>
          <span style={{ fontSize: 12.5, color: C.mut }}>
            Allocated by {a.allocatedByName} · {fmtDT(a.allocatedAt)} · Deadline {fmtDT(a.deadline)} IST
            {a.memberNames && a.memberNames.length > 1 ? ` · Team: ${a.memberNames.join(', ')}` : ''}
          </span>
          <Steps steps={['Allocated', 'In Progress', 'Submitted', 'Under Review', 'Result']} cur={STEP_OF[a.status] ?? 0} sub={stepSub} iw={120} lw={40} />
        </Card>
        <Timer
          big
          live
          d={parts.d}
          h={parts.h}
          m={parts.m}
          tone={tone}
          i={t.stopped ? 'pause' : 'timer'}
          label={t.stopped ? toneLabel : t.notStarted ? `Starts ${fmtDT(a.startAt)}` : `Time left · ${toneLabel}`}
          foot={t.stopped ? `Submitted ${fmtDT(a.submittedAt)}` : sentRem.length ? `Reminder sent ${sentRem[sentRem.length - 1]} before${nextRem.length ? ` · next at ${nextRem.join(' and ')}` : ''}` : `Reminders at ${nextRem.join(', ')} before the deadline`}
          style={{ width: 400, flexShrink: 0, padding: 22 }}
        />
      </Row>

      {a.review && a.review.published && (
        <Note tone={a.status === 'qualified' ? 'ok' : 'or'} i={a.status === 'qualified' ? 'checkc' : 'alert'}>
          Result: {a.review.score} / 100 → {a.status === 'qualified' ? 'Qualified' : 'Not Qualified'} (passing {b.passScore || 60}) · reviewed by {a.review.byName}
          {a.review.feedback ? ` — “${a.review.feedback}”` : ''}
          {resubmitting ? ` · You can resubmit until ${fmtDT(a.resubmit.deadline)}` : ''}
        </Note>
      )}
      {a.status === 'disqualified' && (
        <Note tone="er" i="alert">
          The deadline passed with no submission, so this project is Disqualified. Ask support or your mentor to re-allocate it.
        </Note>
      )}

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Col>
          <Card title="Brief" i="book">
            <span style={{ fontSize: 13, color: C.sub, lineHeight: '20px', whiteSpace: 'pre-wrap' }}>{b.description || '—'}</span>
            <Lbl>Deliverables</Lbl>
            {(b.deliverables || []).map((d, i) => (
              <Check key={d} label={d} on={!!(a.deliverablesDone || [])[i]} onChange={(v) => toggleDel(i, v)} s={12.5} />
            ))}
            <Lbl>Resources</Lbl>
            <Row g={8} className="g-wrap">
              {(b.resources || []).length ? (
                b.resources.map((r) => (
                  <Btn key={r.url} k="s" sm i={r.kind === 'link' ? 'link' : 'download'} href={r.url} target="_blank">
                    {r.name}
                  </Btn>
                ))
              ) : (
                <span className="g-s12 g-fa">No files attached.</span>
              )}
            </Row>
          </Card>
          <Card title="How you will be scored" i="list" sub={`Passing score ${b.passScore || 60} / 100 · ${(b.resubmissions && b.resubmissions.allowed) || 0} resubmission${(b.resubmissions && b.resubmissions.allowed) === 1 ? '' : 's'} allowed`}>
            {[...(b.rubric || [])]
              .sort((x, y) => y.max - x.max)
              .map((r) => {
                const got = a.review && a.review.published ? (a.review.scores || []).find((s) => s.criterion === r.criterion) : null;
                return (
                  <Row key={r.criterion} g={10} className="g-ac">
                    <span style={{ fontSize: 12.5, width: 170, flexShrink: 0 }} title={r.lookFor}>
                      {r.criterion}
                    </span>
                    <div style={{ flex: 1, maxWidth: 300 }}>
                      <Bar pct={got ? (got.score / r.max) * 100 : (r.max / maxR) * 100} tone="ind" />
                    </div>
                    <b style={{ fontSize: 12 }}>{got ? `${got.score} / ${r.max}` : `${r.max} pts`}</b>
                  </Row>
                );
              })}
          </Card>
          <Card title="Activity timeline" i="clock">
            {[...(a.timeline || [])].reverse().map((e, i) => (
              <Row key={i} g={12} className="g-ac">
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: (TONE[e.tone] || TONE.mut)[1], flexShrink: 0 }} />
                <b style={{ fontSize: 12, width: 110, flexShrink: 0 }}>{fmtShort(e.at)}</b>
                <span style={{ fontSize: 12.5, color: C.sub, flex: 1 }}>{e.text}</span>
              </Row>
            ))}
          </Card>
        </Col>

        <Col style={{ width: 420, flexShrink: 0 }}>
          <Card title={a.submission && !resubmitting ? `Submitted · v${a.submission.version}` : 'Submit your work'} i="upload" sub={canSubmit ? `Locks automatically at ${fmtDT(resubmitting ? a.resubmit.deadline : a.deadline)}` : a.submittedAt ? `Submitted ${fmtDT(a.submittedAt)}` : 'Locked'}>
            <Field label="GitHub repository" htmlFor="s-gh">
              <div className="g-input">
                <I n="git" s={15} c={C.fa} />
                <input id="s-gh" value={f.githubUrl} disabled={!canSubmit} onChange={(e) => setF({ ...f, githubUrl: e.target.value })} placeholder="github.com/you/project" />
              </div>
            </Field>
            <Field label="Live demo URL" htmlFor="s-demo">
              <div className="g-input">
                <I n="globe" s={15} c={C.fa} />
                <input id="s-demo" value={f.demoUrl} disabled={!canSubmit} onChange={(e) => setF({ ...f, demoUrl: e.target.value })} placeholder="your-app.onrender.com" />
              </div>
            </Field>
            <Col g={6}>
              <span className="g-field-l">Files &amp; project report</span>
              {f.files.map((x, i) => (
                <Row key={`${x.url}${i}`} g={10} className="g-ac" style={{ background: C.bg, borderRadius: 8, padding: '8px 10px' }}>
                  <IB n="file" tone={fileTone(x.name)} box={28} s={14} />
                  <a href={x.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, flex: 1, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {x.name}
                    {x.size ? ` · ${kb(x.size)}` : ''}
                  </a>
                  {canSubmit && (
                    <button type="button" onClick={() => setF({ ...f, files: f.files.filter((_, j) => j !== i) })} aria-label={`Remove ${x.name}`} style={{ border: 0, background: 'none', cursor: 'pointer', color: C.fa }}>
                      <I n="x" s={14} />
                    </button>
                  )}
                </Row>
              ))}
              {canSubmit && (
                <>
                  <input ref={fileRef} type="file" multiple accept=".zip,.pdf,.ipynb,.rar,.csv,.py,.txt" style={{ display: 'none' }} onChange={onFiles} />
                  <button type="button" onClick={() => fileRef.current && fileRef.current.click()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 8, border: '1px dashed #cbd5e1', background: 'none', cursor: 'pointer', color: C.pri, fontWeight: 600, fontSize: 12.5 }}>
                    <I n="upload" s={16} />
                    {up ? 'Uploading…' : 'Add files (ZIP, PDF, IPYNB)'}
                  </button>
                </>
              )}
            </Col>
            {canSubmit ? (
              <>
                <Note tone="wa" i="lock">
                  Submitting stops your timer and records time taken. You can&apos;t edit after the deadline.
                </Note>
                <Row g={8}>
                  <Btn k="s" i="file" onClick={() => saveDraft()} disabled={busy} style={{ flex: 1 }}>
                    Save draft
                  </Btn>
                  <Btn k="p" i="send" onClick={submit} disabled={busy || (t.notStarted && !resubmitting)} style={{ flex: 1 }}>
                    {resubmitting ? 'Resubmit project' : 'Submit project'}
                  </Btn>
                </Row>
              </>
            ) : (
              <Note tone="mut" i="lock">
                {a.submittedAt ? `Submitted ${fmtDT(a.submittedAt)} · time taken ${Math.floor((a.timeTakenMs || 0) / 86400000)}d ${Math.floor(((a.timeTakenMs || 0) % 86400000) / 3600000)}h` : 'The deadline has passed — submission is locked.'}
              </Note>
            )}
          </Card>

          {['allocated', 'in_progress'].includes(a.status) && (
            <Card title="Need more time?" i="clock" sub="Your mentor approves or rejects extension requests">
              {a.extension && a.extension.status === 'pending' ? (
                <Note tone="pk" i="clock">
                  Requested +{a.extension.days} day{a.extension.days === 1 ? '' : 's'} on {fmtDT(a.extension.requestedAt)} — waiting for your mentor.
                </Note>
              ) : (
                <>
                  {a.extension && a.extension.status !== 'none' && (
                    <Note tone={a.extension.status === 'approved' ? 'ok' : 'er'} i={a.extension.status === 'approved' ? 'checkc' : 'x'}>
                      Last request {a.extension.status} by {a.extension.decidedByName || 'your mentor'}
                      {a.extension.status === 'approved' ? ` (+${a.extension.grantedDays} d)` : ''}.
                    </Note>
                  )}
                  <Field label="Extra time needed" htmlFor="x-days">
                    <select id="x-days" className="g-input" value={ext.days} onChange={(e) => setExt({ ...ext, days: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5, 7].map((n) => (
                        <option key={n} value={n}>
                          {n} day{n === 1 ? '' : 's'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Reason" htmlFor="x-reason">
                    <textarea id="x-reason" className="g-input" rows={2} style={{ minHeight: 56 }} value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} placeholder="Dataset API was down on 22–23 Nov…" />
                  </Field>
                  <span>
                    <Btn k="wa" i="send" onClick={askExt} disabled={busy || ext.reason.trim().length < 5}>
                      Request extension
                    </Btn>
                  </span>
                </>
              )}
            </Card>
          )}

          <Card title="My other projects" i="folder">
            {others.length === 0 && <span className="g-s12 g-fa">No other projects.</span>}
            {others.map((o) => {
              const [l, tn] = STATUS[statusOf(o)] || [o.status, 'mut'];
              return (
                <button key={o.id} type="button" onClick={() => onPick(o.id)} className="g-kv" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: C.ink }}>{o.title}</span>
                  <Chip tone={tn} dot>
                    {o.review && o.review.published ? `${l} · ${o.review.score}` : o.status === 'not_qualified' && o.resubmit && o.resubmit.allowed ? `${l} · resubmit` : l}
                  </Chip>
                </button>
              );
            })}
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}

export default function MyProjects() {
  const { data, error, loading, reload } = useData(() => api.myProjects(), []);
  const [pick, setPick] = useState(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const rows = (data && data.rows) || [];
  if (!rows.length)
    return (
      <Screen crumb="LMS / Projects" title="My projects">
        <Card>
          <div className="g-empty">No project has been allocated to you yet. When your mentor allocates one, it shows here with a live deadline timer.</div>
        </Card>
      </Screen>
    );
  const open = rows.filter((r) => ['allocated', 'in_progress', 'not_qualified'].includes(r.status));
  const cur = pick || (open.sort((x, y) => new Date(x.deadline) - new Date(y.deadline))[0] || rows[0]).id;
  return <ProjectView key={cur} id={cur} others={rows.filter((r) => r.id !== cur)} onPick={setPick} reloadList={reload} />;
}
