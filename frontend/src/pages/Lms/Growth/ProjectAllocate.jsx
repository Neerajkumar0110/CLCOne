import React, { useEffect, useMemo, useState } from 'react';
import { message, Modal } from 'antd';
import api from './api';
import { C, I, IB, Chip, Btn, Av, Card, Row, Col, Table, Check, KV, Note, Screen, Loading, ErrorBox, Field, useData } from './ui';
import { fmtDT } from './projectsShared';

// Figma 2B "Allocate project" (Mentor / Admin): individual, group (auto-
// balanced), auto by track / skill, or a whole batch. Learners are notified
// by email + in-app and their timer starts.

const MODES = [
  ['individual', 'user', 'Individual', 'Pick learners one by one'],
  ['group', 'users', 'Group', 'Teams of 2–4, auto-balanced'],
  ['auto', 'zap', 'Auto by track / skill', 'Rule-based matching'],
  ['bulk', 'layers', 'Bulk · whole batch', 'Everyone in a batch'],
];
const LV = { advanced: ['Advanced', 'ok'], intermediate: ['Intermediate', 'sky'], beginner: ['Beginner', 'mut'] };
const ORDER = ['beginner', 'intermediate', 'advanced'];
const AVC = [C.pri, C.ind, C.pu, C.ok];

// balanced teams: strongest + weakest mixed round-robin
function balance(list, size) {
  const sorted = [...list].sort((a, b) => (b.skillScore ?? -1) - (a.skillScore ?? -1));
  const n = Math.max(1, Math.ceil(sorted.length / size));
  const groups = Array.from({ length: n }, (_, i) => ({ name: `Group ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`, members: [] }));
  sorted.forEach((l, i) => {
    const round = Math.floor(i / n);
    const idx = round % 2 === 0 ? i % n : n - 1 - (i % n);
    groups[idx].members.push(l);
  });
  return groups.filter((g) => g.members.length);
}

export default function ProjectAllocate({ briefId, onDone, onCancel }) {
  const briefQ = useData(() => api.brief(briefId), [briefId]);
  const [batch, setBatch] = useState('');
  const candQ = useData(() => api.candidates(briefId, batch || undefined), [briefId, batch]);
  const [mode, setMode] = useState('individual');
  const [sel, setSel] = useState(new Set());
  const [minSkill, setMinSkill] = useState('');
  const [size, setSize] = useState(3);
  const [groups, setGroups] = useState([]);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [rule, setRule] = useState({ track: '', minSkill: 'intermediate', on: true });
  const [notify, setNotify] = useState({ email: true, inApp: true, copyMentor: true });
  const [busy, setBusy] = useState(false);
  // learner lookup: name, or the beginning of the email (LMS testing report #8)
  const [q, setQ] = useState('');

  const cand = candQ.data;
  useEffect(() => {
    if (cand && !batch && cand.batch) setBatch(cand.batch);
  }, [cand, batch]);
  const brief = briefQ.data;
  useEffect(() => {
    if (brief) {
      setRule((r) => ({ ...r, track: r.track || brief.track || '', minSkill: brief.skillLevel || r.minSkill }));
      if (brief.rules && brief.rules.allowGroups) setMode('group');
    }
  }, [brief]);
  const rows = useMemo(() => (cand ? cand.rows : []), [cand]);
  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!minSkill || (r.skill && ORDER.indexOf(r.skill) >= ORDER.indexOf(minSkill))) &&
        (!t || String(r.name || '').toLowerCase().includes(t) || String(r.email || '').toLowerCase().startsWith(t))
    );
  }, [rows, minSkill, q]);
  useEffect(() => {
    // default: everyone matching the brief's skill level and not already on it
    if (!rows.length) return;
    setSel(new Set(rows.filter((r) => !r.allocated).map((r) => r.id)));
  }, [rows]);
  const picked = rows.filter((r) => sel.has(r.id) && !r.allocated);
  useEffect(() => {
    if (mode === 'group') setGroups(balance(picked, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, size, sel, rows]);
  const autoMatch = rows.filter((r) => (!rule.track || r.track === rule.track) && r.skill && ORDER.indexOf(r.skill) >= ORDER.indexOf(rule.minSkill || 'beginner'));

  if (briefQ.loading || (candQ.loading && !cand)) return <Loading text="Loading learners…" />;
  if (briefQ.error) return <ErrorBox text={briefQ.error} />;
  if (candQ.error) return <ErrorBox text={candQ.error} />;
  const count = mode === 'bulk' ? rows.filter((r) => !r.allocated).length : mode === 'auto' ? autoMatch.filter((r) => !r.allocated).length : picked.length;
  const deadline = brief.deadline ? new Date(brief.deadline) : brief.durationDays ? new Date(Date.now() + brief.durationDays * 86400000) : null;

  // confirm learner(s), project and notifications before anything is sent (report #8)
  const go = () => {
    if (!count) return message.error('Nobody selected.');
    const names = mode === 'individual' ? picked.map((r) => `${r.name}${r.email ? ` (${r.email})` : ''}`) : [];
    Modal.confirm({
      title: `Assign "${brief.title}"?`,
      width: 520,
      okText: `Assign & notify ${count}`,
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div><b>Project:</b> {brief.title}{brief.track ? ` · ${brief.track}` : ''}</div>
          <div><b>Batch:</b> {batch || '—'} · <b>Mode:</b> {(MODES.find((m) => m[0] === mode) || [])[2]}</div>
          <div><b>Learners ({count}):</b> {names.length ? names.slice(0, 8).join(', ') + (names.length > 8 ? ` +${names.length - 8} more` : '') : mode === 'bulk' ? 'everyone in the batch' : mode === 'auto' ? 'everyone matching the rule' : `${count}`}</div>
          <div><b>Deadline:</b> {deadline ? fmtDT(deadline) : '—'}</div>
          <div><b>Notify:</b> {[notify.email && 'email', notify.inApp && 'LMS notification', notify.copyMentor && 'copy to mentor'].filter(Boolean).join(' · ') || 'nobody'}</div>
        </div>
      ),
      onOk: send,
    });
  };
  const send = async () => {
    setBusy(true);
    const body = { mode, batch, notify };
    if (mode === 'individual') body.learnerIds = picked.map((r) => r.id);
    if (mode === 'group') body.groups = groups.map((g) => ({ name: g.name, members: g.members.map((m) => m.id) }));
    if (mode === 'auto') body.rule = rule;
    const r = await api.allocate(briefId, body);
    setBusy(false);
    if (!r.success) return message.error(r.message);
    message.success(r.message);
    if (onDone) onDone('dashboard');
    else candQ.reload();
  };
  const toggle = (id) => {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSel(s);
  };
  const allOn = visible.filter((r) => !r.allocated).every((r) => sel.has(r.id));

  return (
    <Screen
      crumb={`LMS / Projects / ${brief.title} / Allocate`}
      title={`Allocate · ${brief.title}`}
      actions={
        <>
          {onCancel && (
            <Btn k="g" onClick={onCancel}>
              Back
            </Btn>
          )}
          <Btn k="p" i="send" onClick={go} disabled={busy || !count}>
            {busy ? 'Allocating…' : `Allocate & notify ${count}`}
          </Btn>
        </>
      }
    >
      <Row className="g-rs">
        {MODES.map(([k, ic, l, sub]) => {
          const on = mode === k;
          const disabled = k === 'group' && !(brief.rules && brief.rules.allowGroups);
          return (
            <button
              key={k}
              type="button"
              onClick={() => (disabled ? message.info('Turn on "Allow group submissions" in the project rules first.') : setMode(k))}
              aria-pressed={on}
              className="g-card"
              style={{ flex: 1, padding: 16, gap: 8, textAlign: 'left', cursor: 'pointer', borderColor: on ? C.pri : C.ln, background: on ? C.priL : C.w, opacity: disabled ? 0.55 : 1 }}
            >
              <Row g={10} className="g-ac">
                <IB n={ic} bg={on ? C.pri : C.bg2} c={on ? C.w : C.sub} />
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{l}</span>
                <span style={{ width: 18, height: 18, borderRadius: 999, border: on ? `5px solid ${C.pri}` : '1.5px solid #cbd5e1', flexShrink: 0 }} />
              </Row>
              <span className="g-s12 g-mut">{sub}</span>
            </button>
          );
        })}
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title="Select learners"
          i="users"
          sub={mode === 'bulk' ? `Whole batch · ${rows.filter((r) => !r.allocated).length} learners` : mode === 'auto' ? `${autoMatch.length} match the rule` : `${picked.length} of ${rows.length} selected`}
          style={{ flex: 1 }}
          right={
            <Row g={8} style={{ width: 'auto', flexWrap: 'wrap' }}>
              <div className="g-input" style={{ padding: '5px 10px', width: 'auto' }}>
                <I n="search" s={13} c={C.fa} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email starts with…" aria-label="Find a learner by name or email" style={{ border: 0, outline: 0, fontSize: 12, width: 170, background: 'transparent' }} />
              </div>
              <div className="g-input" style={{ padding: '5px 10px', width: 'auto' }}>
                <I n="layers" s={13} c={C.fa} />
                <select value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch" style={{ fontSize: 12, fontWeight: 600 }}>
                  {(cand ? cand.batches : []).map((b) => (
                    <option key={b} value={b}>
                      Batch: {b}
                    </option>
                  ))}
                </select>
              </div>
              <div className="g-input" style={{ padding: '5px 10px', width: 'auto' }}>
                <I n="filter" s={13} c={C.fa} />
                <select value={minSkill} onChange={(e) => setMinSkill(e.target.value)} aria-label="Skill filter" style={{ fontSize: 12, fontWeight: 600 }}>
                  <option value="">Skill: All</option>
                  <option value="intermediate">Skill: Intermediate+</option>
                  <option value="advanced">Skill: Advanced</option>
                </select>
              </div>
            </Row>
          }
        >
          <Table
            cols={[
              [<Check on={allOn && visible.length > 0} onChange={() => setSel(allOn ? new Set() : new Set([...sel, ...visible.filter((r) => !r.allocated).map((r) => r.id)]))} label="" />, 34],
              ['Learner', 'f'],
              ['Track', 160],
              ['Skill level', 110],
              ['Active projects', 110],
            ]}
            rows={visible.map((r) => [
              r.allocated ? <Chip s={10}>Has it</Chip> : <Check on={mode === 'bulk' || (mode === 'auto' ? autoMatch.includes(r) : sel.has(r.id))} onChange={() => mode !== 'bulk' && mode !== 'auto' && toggle(r.id)} label="" />,
              <>
                <Av name={r.name} s={24} />
                <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</span>
                  {r.email ? <span className="g-s11 g-fa">{r.email}</span> : null}
                </span>
              </>,
              r.track || '—',
              r.skill ? (
                <Chip tone={LV[r.skill][1]} s={10.5}>
                  {LV[r.skill][0]}
                </Chip>
              ) : (
                <span className="g-fa">no score yet</span>
              ),
              String(r.active),
            ])}
            empty={q ? 'No learner matches that name / email.' : 'No learners in this batch.'}
          />
          <span className="g-s11 g-fa">Skill level comes from each learner's real coding + assessment scores (Learner 360°).</span>
        </Card>

        {mode === 'group' && (
          <Card
            title="Groups (auto-balanced)"
            i="users"
            sub={`${groups.length} groups of ${size} · mixed skill levels`}
            style={{ width: 330, flexShrink: 0 }}
            right={
              <Row g={6} style={{ width: 'auto' }}>
                <select className="g-input" style={{ width: 'auto', padding: '4px 6px', fontSize: 12 }} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Group size">
                  {[2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} / group
                    </option>
                  ))}
                </select>
                <Btn k="g" sm i="refresh" onClick={() => setGroups(balance([...picked].sort(() => Math.random() - 0.5), size))}>
                  Shuffle
                </Btn>
              </Row>
            }
          >
            {(showAllGroups ? groups : groups.slice(0, 4)).map((g, gi) => (
              <Row key={g.name} g={10} className="g-ac" style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
                <span style={{ display: 'inline-flex' }}>
                  {g.members.slice(0, 3).map((m, i) => (
                    <span key={m.id} style={{ marginLeft: i ? -8 : 0, border: '2px solid #fff', borderRadius: 999 }}>
                      <Av name={m.name} s={26} col={AVC[i % 4]} />
                    </span>
                  ))}
                </span>
                <Col g={0} style={{ flex: 1 }}>
                  <input
                    value={g.name}
                    onChange={(e) => setGroups(groups.map((x, j) => (j === gi ? { ...x, name: e.target.value } : x)))}
                    aria-label="Group name"
                    style={{ border: 0, background: 'transparent', fontSize: 12.5, fontWeight: 600, padding: 0 }}
                  />
                  <span className="g-s115 g-mut">{g.members.map((m) => m.name.split(' ')[0]).join(' · ')}</span>
                </Col>
                <I n="edit" c={C.fa} s={14} />
              </Row>
            ))}
            {groups.length > 4 && (
              <button type="button" onClick={() => setShowAllGroups(!showAllGroups)} style={{ border: 0, background: 'none', color: C.pri, fontWeight: 600, fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                {showAllGroups ? 'Show fewer' : `+ ${groups.length - 4} more groups`}
              </button>
            )}
            {!groups.length && <span className="g-s12 g-fa">Select learners to build groups.</span>}
          </Card>
        )}

        <Col style={{ width: 330, flexShrink: 0 }}>
          <Card title="Project details" i="file" sub="What the learner gets">
            {brief.description ? <span className="g-s12" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto', display: 'block' }}>{brief.description}</span> : <span className="g-s12 g-fa">No description.</span>}
            {(brief.deliverables || []).length > 0 && (
              <>
                <span className="g-s11 g-mut" style={{ fontWeight: 600, marginTop: 6 }}>Requirements / deliverables</span>
                <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: 12 }}>
                  {brief.deliverables.slice(0, 10).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </>
            )}
            {(brief.stack || []).length > 0 && <KV k="Stack" v={brief.stack.join(', ')} />}
            {(brief.resources || []).length > 0 && <KV k="Resources" v={`${brief.resources.length} file${brief.resources.length === 1 ? '' : 's'} / link${brief.resources.length === 1 ? '' : 's'}`} />}
            <KV k="Pass score" v={`${brief.passScore || 60}%`} />
          </Card>
          <Card title="Auto-allocation rule" i="zap">
            <Field label="Track" htmlFor="ar-track">
              <select id="ar-track" className="g-input" value={rule.track} onChange={(e) => setRule({ ...rule, track: e.target.value })}>
                <option value="">Any track</option>
                {[...new Set(rows.map((r) => r.track).filter(Boolean))].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Skill level" htmlFor="ar-skill">
              <select id="ar-skill" className="g-input" value={rule.minSkill} onChange={(e) => setRule({ ...rule, minSkill: e.target.value })}>
                <option value="beginner">All levels</option>
                <option value="intermediate">Intermediate and above</option>
                <option value="advanced">Advanced only</option>
              </select>
            </Field>
            <Note tone="sky" i="users">
              Matches {autoMatch.length} learner{autoMatch.length === 1 ? '' : 's'}
              {mode === 'auto' ? ' · new learners who match are allocated automatically' : ' · choose "Auto by track / skill" to use it'}
            </Note>
          </Card>
          <Card title="Notify & start" i="bell">
            <Check label="Email to learners" on={notify.email} onChange={(v) => setNotify({ ...notify, email: v })} />
            <Check label="In-app notification" on={notify.inApp} onChange={(v) => setNotify({ ...notify, inApp: v })} />
            <Check label="Copy mentor on email" on={notify.copyMentor} onChange={(v) => setNotify({ ...notify, copyMentor: v })} />
            <KV k="Timer starts" v={brief.timerStart === 'startDate' ? `On ${fmtDT(brief.startDate)}` : 'On allocation'} />
            <KV k="Deadline" v={deadline ? fmtDT(deadline) : '—'} />
            <KV k="Allocation" v={mode === 'group' ? `${picked.length} learners · ${groups.length} groups` : `${count} learner${count === 1 ? '' : 's'}`} c={C.pri} />
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}
