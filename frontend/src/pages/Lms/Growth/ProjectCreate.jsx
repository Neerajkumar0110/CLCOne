import React, { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, I, IB, Chip, Btn, Card, Row, Col, Field, Table, Tabs, Check, Toggle, Lbl, Screen, Loading } from './ui';
import { toLocalInput, kb, fileTone } from './projectsShared';
import './projectsX.css';

// Figma 2A "Create project" (Admin / Mentor). Save draft, or Save & allocate → 2B.

const DEF_RUBRIC = [
  { criterion: 'Problem understanding', lookFor: 'EDA, clear problem framing', max: 15 },
  { criterion: 'Functionality', lookFor: 'Works end to end, correct output', max: 30 },
  { criterion: 'Code quality', lookFor: 'Structure, tests, readability', max: 25 },
  { criterion: 'Documentation', lookFor: 'README, report clarity', max: 15 },
  { criterion: 'Demo & presentation', lookFor: 'Live demo, explanation', max: 15 },
];
const EMPTY = {
  title: '',
  description: '',
  difficulty: 'intermediate',
  track: '',
  skillLevel: 'intermediate',
  stack: [],
  deliverables: ['GitHub repository with README', 'Live demo URL', 'Project report (PDF, 2–4 pages)'],
  rubric: DEF_RUBRIC,
  passScore: 60,
  resubmissions: { allowed: 1, withinDays: 3 },
  timerStart: 'allocation',
  startDate: null,
  deadline: null,
  reminders: { h48: true, h24: true, h1: true, customH: null },
  channels: { email: true, inApp: true, whatsapp: false },
  resources: [],
  rules: { lockAfterDeadline: true, autoDisqualify: true, allowExtension: true, allowGroups: false },
};
const LEVEL = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
];

export default function ProjectCreate({ id, onDone, onCancel }) {
  const [f, setF] = useState(id ? null : EMPTY);
  const [meta, setMeta] = useState({ tracks: [] });
  const [stackIn, setStackIn] = useState('');
  const [newDel, setNewDel] = useState('');
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState(false);
  const [link, setLink] = useState('');
  const [time, setTime] = useState('23:59');
  const [date, setDate] = useState('');
  const fileRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    api.projectMeta().then((r) => r.success && setMeta(r.result));
    if (id)
      api.brief(id).then((r) => {
        if (!r.success) return message.error(r.message);
        const b = r.result;
        setF({ ...EMPTY, ...b, reminders: { ...EMPTY.reminders, ...(b.reminders || {}) }, channels: { ...EMPTY.channels, ...(b.channels || {}) }, rules: { ...EMPTY.rules, ...(b.rules || {}) } });
        if (b.deadline) {
          const v = toLocalInput(b.deadline);
          setDate(v.slice(0, 10));
          setTime(v.slice(11, 16));
        }
      });
  }, [id]);
  if (!f) return <Loading />;
  const set = (k, v) => setF({ ...f, [k]: v });
  const total = f.rubric.reduce((s, r) => s + (Number(r.max) || 0), 0);

  const body = (publish) => ({ ...f, deadline: date ? new Date(`${date}T${time || '23:59'}`) : null, startDate: f.timerStart === 'startDate' && f.startDate ? new Date(f.startDate) : null, publish });
  const save = async (publish) => {
    setBusy(true);
    const r = await api.saveBrief(id || f.id, body(publish));
    setBusy(false);
    if (!r.success) return message.error(r.message);
    message.success(r.message);
    setF({ ...f, id: r.result.id });
    if (publish && onDone) onDone('allocate', r.result.id);
  };
  const addStack = () => {
    const v = stackIn.trim();
    if (v && !f.stack.includes(v)) set('stack', [...f.stack, v]);
    setStackIn('');
  };
  const onFile = async (e) => {
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
    if (added.length) set('resources', [...f.resources, ...added]);
  };
  // a project document (.docx / .txt / .md) fills title, description and
  // requirements; the file is kept as a resource too (LMS testing report #7)
  const fillFromDoc = async (file) => {
    if (!file) return;
    setUp(true);
    const r = await api.extractProjectFile(file);
    setUp(false);
    if (!r.success) return message.error(r.message);
    const x = r.result.extracted || {};
    const { extracted, ...res } = r.result;
    setF((prev) => ({
      ...prev,
      title: prev.title || x.title || prev.title,
      description: x.description ? (prev.description ? `${prev.description}\n\n${x.description}` : x.description) : prev.description,
      deliverables: x.deliverables && x.deliverables.length ? [...new Set([...(prev.deliverables || []), ...x.deliverables])] : prev.deliverables,
      stack: x.stack && x.stack.length ? [...new Set([...(prev.stack || []), ...x.stack])] : prev.stack,
      resources: [...(prev.resources || []), res],
    }));
    if (x.unsupported) message.info(x.reason, 6);
    else message.success('Details filled from the document — check and edit them.');
  };
  const addLink = () => {
    const v = link.trim();
    if (!v) return;
    set('resources', [...f.resources, { name: v.replace(/^https?:\/\//, '').slice(0, 60), url: /^https?:\/\//.test(v) ? v : `https://${v}`, size: 0, kind: 'link' }]);
    setLink('');
  };
  const moveDel = (from, to) => {
    if (to < 0 || to >= f.deliverables.length) return;
    const d = [...f.deliverables];
    const [x] = d.splice(from, 1);
    d.splice(to, 0, x);
    set('deliverables', d);
  };

  return (
    <Screen className="pjx pjx-create"
      crumb={`LMS / Projects / ${id ? f.title || 'Edit' : 'New'}`}
      title={id ? `Edit · ${f.title}` : 'New project'}
      actions={
        <>
          {onCancel && (
            <Btn k="g" onClick={onCancel}>
              Back
            </Btn>
          )}
          <Btn k="s" i="file" onClick={() => save(false)} disabled={busy}>
            Save draft
          </Btn>
          <Btn k="p" i="send" onClick={() => save(true)} disabled={busy}>
            Save &amp; allocate
          </Btn>
        </>
      }
    >
      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Col>
          <Card
            title="Project details"
            i="folder"
            right={
              <label className="g-btn k-g sm" style={{ cursor: up ? 'wait' : 'pointer' }} title="Upload the project document (.docx / .txt / .md) — title, description and requirements are filled from it">
                <I n="upload" s={13} />
                {up ? 'Reading…' : 'Fill from document'}
                <input type="file" accept=".docx,.txt,.md,.pdf" hidden disabled={up} onChange={(e) => { fillFromDoc(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </label>
            }
          >
            <Field label="Project title" htmlFor="p-title">
              <input id="p-title" className="g-input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Churn Prediction API" />
            </Field>
            <Field label="Description" htmlFor="p-desc">
              <textarea id="p-desc" className="g-input" rows={4} style={{ minHeight: 84 }} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What the learner builds, the dataset, what must be delivered…" />
            </Field>
            <Row g={16} className="g-rm">
              <Col g={6}>
                <span className="g-field-l">Difficulty</span>
                <Tabs items={LEVEL} act={f.difficulty} onChange={(v) => set('difficulty', v)} />
              </Col>
              <Field label="Track / skill level" htmlFor="p-track">
                <div className="g-input">
                  <I n="layers" s={15} c={C.fa} />
                  <select id="p-track" value={f.track} onChange={(e) => set('track', e.target.value)}>
                    <option value="">Any track</option>
                    {meta.tracks.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select value={f.skillLevel} onChange={(e) => set('skillLevel', e.target.value)} aria-label="Skill level" style={{ flex: '0 0 auto' }}>
                    {LEVEL.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </Row>
            <Col g={6}>
              <span className="g-field-l">Tech stack</span>
              <Row g={6} className="g-wrap g-ac">
                {f.stack.map((s) => (
                  <button key={s} type="button" onClick={() => set('stack', f.stack.filter((x) => x !== s))} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer' }} aria-label={`Remove ${s}`}>
                    <Chip tone="ind" s={12}>
                      {s} ×
                    </Chip>
                  </button>
                ))}
                <input className="g-input" style={{ width: 140, padding: '5px 10px' }} value={stackIn} onChange={(e) => setStackIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addStack())} placeholder="e.g. FastAPI" aria-label="Add technology" />
                <Btn k="g" sm i="plus" onClick={addStack}>
                  Add
                </Btn>
              </Row>
            </Col>
            <Col g={8}>
              <span className="g-field-l">Deliverables</span>
              {f.deliverables.map((d, i) => (
                <Row
                  key={`${d}${i}`}
                  g={8}
                  className="g-ac"
                  style={{ background: C.bg, borderRadius: 8, padding: '8px 10px' }}
                  draggable
                  onDragStart={() => (drag.current = i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => moveDel(drag.current, i)}
                >
                  <span style={{ cursor: 'grab', color: C.fa, display: 'inline-flex' }} title="Drag to reorder">
                    <I n="grip" s={14} />
                  </span>
                  <Check label={d} on s={12.5} />
                  <span style={{ flex: 1 }} />
                  <button type="button" onClick={() => set('deliverables', f.deliverables.filter((_, j) => j !== i))} aria-label={`Remove ${d}`} style={{ border: 0, background: 'none', cursor: 'pointer', color: C.fa }}>
                    <I n="x" s={14} />
                  </button>
                </Row>
              ))}
              <Row g={8}>
                <input className="g-input" value={newDel} onChange={(e) => setNewDel(e.target.value)} placeholder="Add a deliverable" aria-label="New deliverable" onKeyDown={(e) => e.key === 'Enter' && newDel.trim() && (set('deliverables', [...f.deliverables, newDel.trim()]), setNewDel(''))} />
                <Btn k="g" sm i="plus" onClick={() => newDel.trim() && (set('deliverables', [...f.deliverables, newDel.trim()]), setNewDel(''))}>
                  Add
                </Btn>
              </Row>
            </Col>
          </Card>

          <Card
            title="Evaluation rubric & qualification"
            i="list"
            sub="Mentor scores each criterion; total ≥ passing score → Qualified"
            right={
              <Btn k="g" sm i="plus" onClick={() => set('rubric', [...f.rubric, { criterion: '', lookFor: '', max: 0 }])}>
                Add criterion
              </Btn>
            }
          >
            <Table
              cols={[
                ['Criterion', 'f'],
                ['What we look for', 300],
                ['Weight', 70],
                ['Max', 70],
                ['', 30],
              ]}
              rows={f.rubric.map((r, i) => {
                const upd = (k, v) => set('rubric', f.rubric.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                return [
                  <input className="g-input" style={{ padding: '6px 8px' }} value={r.criterion} onChange={(e) => upd('criterion', e.target.value)} aria-label="Criterion" />,
                  <input className="g-input" style={{ padding: '6px 8px' }} value={r.lookFor} onChange={(e) => upd('lookFor', e.target.value)} aria-label="What we look for" />,
                  `${total ? Math.round((r.max / total) * 100) : 0}%`,
                  <input className="g-input" type="number" min={0} max={100} style={{ padding: '6px 8px', width: 56 }} value={r.max} onChange={(e) => upd('max', Number(e.target.value) || 0)} aria-label="Max points" />,
                  <button type="button" onClick={() => set('rubric', f.rubric.filter((_, j) => j !== i))} aria-label="Remove criterion" style={{ border: 0, background: 'none', cursor: 'pointer', color: C.fa }}>
                    <I n="x" s={14} />
                  </button>,
                ];
              })}
            />
            {total !== 100 && (
              <span className="g-help err" role="alert">
                Max points total {total} — they must add up to 100.
              </span>
            )}
            <Row g={16} className="g-rm" style={{ alignItems: 'flex-end' }}>
              <Field label="Minimum passing score" htmlFor="p-pass" style={{ width: 200, flexShrink: 0 }}>
                <div className="g-input">
                  <I n="flag" s={15} c={C.fa} />
                  <input id="p-pass" type="number" min={0} max={100} value={f.passScore} onChange={(e) => set('passScore', Number(e.target.value) || 0)} />
                  <span className="g-mut">/ 100</span>
                </div>
              </Field>
              <Field label="Resubmissions allowed if Not Qualified" htmlFor="p-resub">
                <div className="g-input">
                  <I n="refresh" s={15} c={C.fa} />
                  <select id="p-resub" value={f.resubmissions.allowed} onChange={(e) => set('resubmissions', { ...f.resubmissions, allowed: Number(e.target.value) })}>
                    {[0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'No resubmission' : `${n} attempt${n === 1 ? '' : 's'}`}
                      </option>
                    ))}
                  </select>
                  <span className="g-mut">within</span>
                  <input type="number" min={1} max={30} value={f.resubmissions.withinDays} onChange={(e) => set('resubmissions', { ...f.resubmissions, withinDays: Number(e.target.value) || 1 })} style={{ width: 40, flex: '0 0 auto' }} aria-label="Days to resubmit" />
                  <span className="g-mut">days</span>
                </div>
              </Field>
            </Row>
          </Card>
        </Col>

        <Col style={{ width: 380, flexShrink: 0 }}>
          <Card title="Schedule & deadline" i="cal">
            <Col g={6}>
              <span className="g-field-l">Timer starts</span>
              <Tabs
                items={[
                  ['allocation', 'On allocation'],
                  ['startDate', 'On start date'],
                ]}
                act={f.timerStart}
                onChange={(v) => set('timerStart', v)}
              />
            </Col>
            {f.timerStart === 'startDate' && (
              <Field label="Start date & time" htmlFor="p-start">
                <input id="p-start" type="datetime-local" className="g-input" value={toLocalInput(f.startDate)} onChange={(e) => set('startDate', e.target.value)} />
              </Field>
            )}
            <Row g={10}>
              <Field label="Deadline date" htmlFor="p-dd">
                <div className="g-input">
                  <I n="cal" s={15} c={C.fa} />
                  <input id="p-dd" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </Field>
              <Field label="Time (IST)" htmlFor="p-dt">
                <div className="g-input">
                  <I n="clock" s={15} c={C.fa} />
                  <input id="p-dt" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
              </Field>
            </Row>
            <Lbl>Reminders before deadline</Lbl>
            <Row g={12} className="g-wrap">
              <Check label="48 h" on={f.reminders.h48} onChange={(v) => set('reminders', { ...f.reminders, h48: v })} />
              <Check label="24 h" on={f.reminders.h24} onChange={(v) => set('reminders', { ...f.reminders, h24: v })} />
              <Check label="1 h" on={f.reminders.h1} onChange={(v) => set('reminders', { ...f.reminders, h1: v })} />
              <Check label="Custom" on={!!f.reminders.customH} onChange={(v) => set('reminders', { ...f.reminders, customH: v ? 72 : null })} />
              {!!f.reminders.customH && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <input className="g-input" type="number" min={2} max={336} value={f.reminders.customH} onChange={(e) => set('reminders', { ...f.reminders, customH: Number(e.target.value) || null })} style={{ width: 64, padding: '4px 8px' }} aria-label="Custom reminder hours" />
                  h before
                </span>
              )}
            </Row>
            <Lbl>Channels</Lbl>
            <Row g={12}>
              <Check label="Email" on={f.channels.email} onChange={(v) => set('channels', { ...f.channels, email: v })} />
              <Check label="In-app" on={f.channels.inApp} onChange={(v) => set('channels', { ...f.channels, inApp: v })} />
              <span title="WhatsApp project notices are not connected yet" style={{ opacity: 0.5 }}>
                <Check label="WhatsApp" on={false} />
              </span>
            </Row>
          </Card>

          <Card title="Resources & reference files" i="file">
            {f.resources.map((r, i) => (
              <Row key={`${r.url}${i}`} g={10} className="g-ac" style={{ background: C.bg, borderRadius: 8, padding: '8px 10px' }}>
                <IB n={r.kind === 'link' ? 'link' : 'file'} tone={fileTone(r.name)} box={28} s={14} />
                <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 500, flex: 1, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </a>
                <span className="g-s11 g-mut">{kb(r.size)}</span>
                <button type="button" onClick={() => set('resources', f.resources.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`} style={{ border: 0, background: 'none', cursor: 'pointer', color: C.fa }}>
                  <I n="x" s={14} />
                </button>
              </Row>
            ))}
            <input ref={fileRef} type="file" multiple accept=".pdf,.zip,.csv,.ipynb,.xlsx,.txt,.png,.jpg" style={{ display: 'none' }} onChange={onFile} />
            <button
              type="button"
              onClick={() => fileRef.current && fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile({ target: { files: e.dataTransfer.files, value: '' } });
              }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 16, borderRadius: 10, border: '1px dashed #cbd5e1', background: C.bg, cursor: 'pointer' }}
            >
              <I n="upload" c={C.pri} s={22} />
              <b style={{ fontSize: 12.5 }}>{up ? 'Uploading…' : 'Drop files or add a link'}</b>
              <span className="g-s11 g-mut">PDF, ZIP, CSV, IPYNB · max 50 MB</span>
            </button>
            <Row g={8}>
              <input className="g-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… (dataset, repo, doc)" aria-label="Resource link" onKeyDown={(e) => e.key === 'Enter' && addLink()} />
              <Btn k="g" sm i="link" onClick={addLink}>
                Add link
              </Btn>
            </Row>
          </Card>

          <Card title="Rules" i="shield">
            {[
              ['lockAfterDeadline', 'Lock submission after deadline'],
              ['autoDisqualify', 'Auto-disqualify if not submitted'],
              ['allowExtension', 'Learners can request extension'],
              ['allowGroups', 'Allow group submissions'],
            ].map(([k, l]) => (
              <Row key={k} g={10} className="g-ac">
                <span style={{ fontSize: 12.5, flex: 1 }}>{l}</span>
                <Toggle on={f.rules[k]} onChange={(v) => set('rules', { ...f.rules, [k]: v })} label={l} />
              </Row>
            ))}
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}
