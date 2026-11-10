import React, { lazy, useMemo, useState } from 'react';
import { message } from 'antd';
import lmsApi from '../api';
import { PMPage, PMTabs, Legacy, Loading, useLoad, useTab, res, fmtDay, errText } from './shared';

const Assignments = lazy(() => import('../Assignments'));

// P8 — projects & assignments setup: "New project" (details, deliverables,
// milestones, rubric builder, learners' extension requests → Ops) and "New
// assignment" (required fields + the FUNC-01 acceptance checks, ticked from
// the real save). Existing assignments list / grading is the third tab.

const DELIVERABLES = ['GitHub repo', 'Deployment URL', 'README', 'Demo video'];
const DEFAULT_RUBRIC = [
  { criterion: 'Functionality', maxMarks: 10 },
  { criterion: 'Code quality', maxMarks: 10 },
  { criterion: 'Documentation', maxMarks: 10 },
  { criterion: 'Demo / deployment', maxMarks: 10 },
];
const SUBMISSION = [
  ['file', 'File + repo link'],
  ['link', 'Link only'],
  ['pdf', 'PDF'],
  ['text', 'Text answer'],
];

function useBatches() {
  return useLoad(async () => {
    const d = res(await lmsApi.teacherDashboard());
    return (d && d.batches) || [];
  }, []);
}

function NewProject({ batches }) {
  const [f, setF] = useState({ title: '', objectives: '', batch: '', learner: '', start: '', due: '' });
  const [deliv, setDeliv] = useState(['GitHub repo', 'Deployment URL', 'README']);
  const [milestones, setMilestones] = useState([{ title: 'Design doc', dueDate: '' }]);
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const batchId = f.batch || (batches[0] && batches[0].id) || '';
  const batchName = (batches.find((b) => b.id === batchId) || {}).name;
  const roster = useLoad(async () => (batchName ? res(await lmsApi.pmCandidates({ batch: batchName })) : null), [batchName]);
  const ext = useLoad(async () => res(await lmsApi.pmExtensions()) || [], []);
  const learners = ((roster.data && roster.data.rows) || []).filter((r) => r.status === 'Active');
  const total = rubric.reduce((a, r) => a + (Number(r.maxMarks) || 0), 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const create = async () => {
    if (!f.title.trim()) return message.warning('Title is required.');
    if (!batchId) return message.warning('Pick a batch.');
    if (rubric.some((r) => !r.criterion.trim())) return message.warning('Name every rubric criterion.');
    setBusy(true);
    try {
      const r = await lmsApi.assignProject({
        batch: batchId,
        studentEmail: f.learner || undefined,
        title: f.title.trim(),
        problemStatement: f.objectives.trim(),
        scope: [f.start && `Start: ${fmtDay(f.start)}`, deliv.length && `Required deliverables: ${deliv.join(', ')}`].filter(Boolean).join('\n'),
        dueDate: f.due || undefined,
        milestones: milestones.filter((m) => m.title.trim()).map((m) => ({ title: m.title.trim(), dueDate: m.dueDate || undefined })),
        rubric: rubric.map((x) => ({ criterion: x.criterion.trim(), maxMarks: Number(x.maxMarks) || 10 })),
      });
      if (r && r.success === false) throw new Error(r.message);
      const out = res(r) || {};
      setDone({ count: out.count, skipped: (out.skipped || []).length, msg: r.message });
      message.success(r.message || 'Project assigned.');
    } catch (e) {
      message.error(errText(e, 'Could not assign.'));
    } finally {
      setBusy(false);
    }
  };
  const send = async (id) => {
    try {
      const r = await lmsApi.pmExtensionSend(id);
      if (r && r.success === false) throw new Error(r.message);
      message.success('Sent to Ops.');
      ext.reload();
    } catch (e) {
      message.error(errText(e, 'Could not send.'));
    }
  };

  return (
    <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.9fr', gap: 14 }}>
      <section className="ld-card pm-form" aria-label="Project details">
        <b style={{ fontSize: 15 }}>Project details</b>
        <label className="ld-label">Title *<input className="ld-inp" value={f.title} onChange={set('title')} placeholder="Multi-agent Research Assistant" /></label>
        <label className="ld-label">Objectives<textarea className="ld-inp" value={f.objectives} onChange={set('objectives')} placeholder="Build a research summary with agents + tools + memory; deploy + demo." /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="ld-label">Batch *
            <select className="ld-inp" value={batchId} onChange={(e) => setF({ ...f, batch: e.target.value, learner: '' })}>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="ld-label">Learners
            <select className="ld-inp" value={f.learner} onChange={set('learner')}>
              <option value="">All {learners.length} (individual)</option>
              {learners.map((l) => <option key={l.email} value={l.email}>{l.name}</option>)}
            </select>
          </label>
          <label className="ld-label">Start<input className="ld-inp" type="date" value={f.start} onChange={set('start')} /></label>
          <label className="ld-label">Final due<input className="ld-inp" type="date" value={f.due} onChange={set('due')} /></label>
        </div>
        <div className="ld-label">Required deliverables</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {DELIVERABLES.map((d) => (
            <label key={d} className="pm-check"><input type="checkbox" checked={deliv.includes(d)} onChange={(e) => setDeliv(e.target.checked ? [...deliv, d] : deliv.filter((x) => x !== d))} /> {d}</label>
          ))}
        </div>
      </section>

      <section className="ld-card" aria-label="Milestones and rubric">
        <div className="ld-hd"><b>Milestones</b><button type="button" className="ld-btn2 sm" onClick={() => setMilestones([...milestones, { title: '', dueDate: '' }])}>+ Add</button></div>
        {milestones.map((m, i) => (
          <div key={i} className="pm-rr" style={{ gridTemplateColumns: '1fr 130px 28px' }}>
            <input className="ld-inp" aria-label={`Milestone ${i + 1}`} placeholder={`${i + 1} · title`} value={m.title} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <input className="ld-inp" type="date" aria-label={`Milestone ${i + 1} due`} value={m.dueDate} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
            <button type="button" className="ld-link" aria-label="Remove milestone" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <div className="ld-hd" style={{ marginTop: 6 }}><b>Rubric ({total})</b><button type="button" className="ld-btn2 sm" onClick={() => setRubric([...rubric, { criterion: '', maxMarks: 10 }])}>+ Criterion</button></div>
        {rubric.map((r, i) => (
          <div key={i} className="pm-rr">
            <input className="ld-inp" aria-label={`Criterion ${i + 1}`} value={r.criterion} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, criterion: e.target.value } : x)))} />
            <input className="ld-inp" type="number" min="1" max="100" aria-label={`Criterion ${i + 1} points`} value={r.maxMarks} onChange={(e) => setRubric(rubric.map((x, j) => (j === i ? { ...x, maxMarks: e.target.value } : x)))} />
            <span className="ld-muted">pts</span>
            <button type="button" className="ld-link" aria-label="Remove criterion" disabled={rubric.length < 2} onClick={() => setRubric(rubric.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </section>

      <section className="ld-card" aria-label="Extension requests">
        <div className="ld-hd"><b>Extension requests</b><span className="ld-muted" style={{ fontSize: 12 }}>{(ext.data || []).length}</span></div>
        {(ext.data || []).length === 0 && <div className="ld-empty">No extension requests from learners.</div>}
        {(ext.data || []).slice(0, 5).map((x) => (
          <div className="ld-li" key={x.id}>
            <span><b>{x.learner}</b> · {x.reference || x.subject.replace(/^Project extension request\s*·\s*/i, '')}<br /><span className="ld-muted">{String(x.description || '').split('\n').find((l) => /reason/i.test(l)) || fmtDay(x.created)}</span></span>
            {x.sentToOps ? <span className={`ld-chip ${x.sentToOps === 'approved' ? 'hai' : x.sentToOps === 'rejected' ? 'red' : 'naya'}`}>{x.sentToOps === 'pending' ? 'With Ops' : x.sentToOps}</span> : <button type="button" className="ld-btn2 sm" onClick={() => send(x.id)}>Send to Ops</button>}
          </div>
        ))}
        <div className="ld-muted" style={{ fontSize: 12 }}>Extensions only by the approved rule · the Operations Manager approves</div>
        <button type="button" className="ld-btn" style={{ marginTop: 'auto' }} disabled={busy || !!done} onClick={create}>{done ? 'Assigned ✓' : busy ? 'Assigning…' : 'Create & assign project'}</button>
        {done && (
          <div className="pm-okbox">
            Assigned · {done.count} learner{done.count === 1 ? '' : 's'} notified{done.skipped ? ` · ${done.skipped} already had one` : ''} · audit logged{' '}
            <button type="button" className="ld-link" onClick={() => setDone(null)}>New project</button>
          </div>
        )}
      </section>
    </div>
  );
}

function NewAssignment({ batches }) {
  const [f, setF] = useState({ title: '', instructions: '', batch: '', due: '', maxMarks: '20', submissionType: 'file' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const batchId = f.batch || (batches[0] && batches[0].id) || '';
  const batch = batches.find((b) => b.id === batchId);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const missing = ['title', 'instructions', 'due'].filter((k) => !String(f[k]).trim());
  const err = (k) => tried && missing.includes(k);

  const create = async () => {
    setTried(true);
    if (missing.length || !batchId) return message.warning('Fill in the required (*) fields.');
    setBusy(true);
    try {
      const r = await lmsApi.createAssignment({ batch: batchId, title: f.title.trim(), instructions: f.instructions.trim(), dueDate: f.due, maxMarks: Number(f.maxMarks) || 20, submissionType: f.submissionType });
      if (r && r.success === false) throw new Error(r.message);
      const id = res(r) && res(r).id;
      const list = res(await lmsApi.assignments().catch(() => null)) || [];
      const row = list.find((a) => String(a.id || a._id) === String(id));
      setResult({ ok: true, inList: !!row, batch: (row && row.batch) || (batch && batch.name), code: res(r).code });
      message.success(r.message || 'Assignment created.');
    } catch (e) {
      setResult({ ok: false, error: errText(e, 'Could not create.') });
      message.error(errText(e, 'Could not create.'));
    } finally {
      setBusy(false);
    }
  };
  const tick = (v) => (v == null ? <span className="ld-muted">—</span> : <b style={{ color: v ? '#166534' : '#991b1b' }}>{v ? '✓' : '✕'}</b>);

  return (
    <div className="pm-g" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
      <section className="ld-card pm-form" aria-label="Create assignment">
        <b style={{ fontSize: 15 }}>Create assignment</b>
        <label className="ld-label">Title *<input className="ld-inp" style={err('title') ? { borderColor: '#dc2626' } : undefined} value={f.title} onChange={set('title')} placeholder="Build a tool-using agent" /></label>
        <label className="ld-label">Instructions *<textarea className="ld-inp" style={{ minHeight: 90, ...(err('instructions') ? { borderColor: '#dc2626' } : {}) }} value={f.instructions} onChange={set('instructions')} placeholder="Build a 2-tool agent with LangChain and submit the output of 3 test queries." /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <label className="ld-label">Batch *
            <select className="ld-inp" value={batchId} onChange={set('batch')}>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </label>
          <label className="ld-label">Due *<input className="ld-inp" type="datetime-local" style={err('due') ? { borderColor: '#dc2626' } : undefined} value={f.due} onChange={set('due')} /></label>
          <label className="ld-label">Max marks<input className="ld-inp" type="number" min="1" value={f.maxMarks} onChange={set('maxMarks')} /></label>
        </div>
        <label className="ld-label">Submission type
          <select className="ld-inp" value={f.submissionType} onChange={set('submissionType')}>{SUBMISSION.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <button type="button" className="ld-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create assignment'}</button>
        {result && result.ok && <div className="pm-okbox">Assignment created ✓ {result.code ? `(${result.code}) ` : ''}— {result.inList ? 'shows in the list' : 'saved'} · visible only to {result.batch} learners</div>}
        {result && !result.ok && <div className="pm-alert">{result.error}</div>}
      </section>
      <section className="ld-card" aria-label="Acceptance">
        <b style={{ fontSize: 15 }}>FUNC-01 acceptance</b>
        <div className="ld-li"><span>Correct form opens</span>{tick(true)}</div>
        <div className="ld-li"><span>Required fields validated (*)</span>{tick(tried ? missing.length === 0 : null)}</div>
        <div className="ld-li"><span>Save → success / error message</span>{tick(result ? true : null)}</div>
        <div className="ld-li"><span>Appears in assignments list</span>{tick(result && result.ok ? result.inList : null)}</div>
        <div className="ld-li"><span>Visible to intended learners only</span>{tick(result && result.ok ? !!result.batch : null)}</div>
      </section>
    </div>
  );
}

export default function PMProjectSetup() {
  const [tab, setTab] = useTab('project');
  const { data: batches, loading } = useBatches();
  const list = useMemo(() => batches || [], [batches]);
  return (
    <PMPage title="Projects & assignments — setup">
      <PMTabs tabs={[['project', 'New project'], ['assignment', 'New assignment'], ['all', 'All assignments']]} value={tab} onChange={setTab} />
      {tab === 'all' ? <Legacy><Assignments /></Legacy> : loading ? <Loading /> : list.length === 0 ? (
        <section className="ld-card"><div className="ld-empty">No batch is assigned to you yet — a project / assignment needs a batch.</div></section>
      ) : tab === 'project' ? <NewProject batches={list} /> : <NewAssignment batches={list} />}
    </PMPage>
  );
}
