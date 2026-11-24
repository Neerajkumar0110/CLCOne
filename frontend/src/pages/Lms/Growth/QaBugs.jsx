import React, { useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, Chip, Btn, Av, Card, Row, Col, KPI, Table, Modal, Field, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 4D "Bug tracker linked to releases" (QA / dev team). Cards move
// between columns (drag, or open the card); a release can't be promoted
// while it has open Critical / High bugs (enforced in 4A).

const COLS = [
  ['open', 'Open', 'er'],
  ['in_progress', 'In progress', 'sky'],
  ['fixed', 'Fixed · ready for QA', 'ind'],
  ['verified', 'Verified', 'ok'],
];
const SEV = { Critical: 'er', High: 'or', Medium: 'wa', Low: 'mut' };
const MODULES = ['Learner 360°', 'Projects', 'Engagement', 'QA', 'Recordings', 'Other'];

export default function QaBugs() {
  const [release, setRelease] = useState('');
  const { data: d, error, loading, reload } = useData(() => api.qaBugs(release || undefined), [release]);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const rel = release || d.release;
  const by = (st) => d.bugs.filter((b) => b.status === st);
  const openCH = d.bugs.filter((b) => b.status === 'open' && ['Critical', 'High'].includes(b.severity));
  const counts = { Critical: 0, High: 0 };
  openCH.forEach((b) => (counts[b.severity] += 1));
  const move = async (bug, status) => {
    if (bug.status === status) return;
    setBusy(true);
    const r = await api.qaSaveBug(bug._id, { status });
    setBusy(false);
    if (r.success) reload();
    else message.error(r.message);
  };
  const save = async () => {
    setBusy(true);
    const r = await api.qaSaveBug(edit._id, edit);
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      setEdit(null);
      reload();
    } else message.error(r.message);
  };
  const promo = (r) => {
    if (r.status === 'live') return ['Live', 'pri'];
    if (r.status === 'superseded' || r.env === 'superseded') return ['Superseded', 'mut'];
    if (r.status === 'rolled_back') return ['Rolled back', 'er'];
    return r.ch ? ['Blocked · Critical / High open', 'er'] : ['Allowed after sign-off', 'ok'];
  };

  return (
    <Screen
      qa
      crumb="LMS / Bug Tracker"
      title={`Bugs · ${rel || 'all releases'}`}
      actions={
        <>
          <div className="g-input" style={{ width: 'auto', padding: '7px 10px' }}>
            <select value={rel || ''} onChange={(e) => setRelease(e.target.value)} aria-label="Release" style={{ fontWeight: 600 }}>
              {d.releases.length === 0 && <option value="">No releases yet</option>}
              {d.releases.map((r) => (
                <option key={r.version} value={r.version}>
                  Release: {r.version}
                </option>
              ))}
            </select>
          </div>
          <Btn k="p" i="bug" onClick={() => setEdit({ title: '', description: '', severity: 'Medium', module: 'Learner 360°', release: rel || '', assignee: '' })}>
            Report bug
          </Btn>
        </>
      }
    >
      <Row className="g-rs">
        <KPI i="bug" label="Open" val={by('open').length} sub={`${counts.Critical} Critical · ${counts.High} High`} tone="wa" style={{ flex: 1 }} />
        <KPI i="code" label="In progress" val={by('in_progress').length} sub="assigned to dev" tone="sky" style={{ flex: 1 }} />
        <KPI i="refresh" label="Fixed · ready for QA" val={by('fixed').length} sub={`re-test on ${rel || 'the release'}`} tone="ind" style={{ flex: 1 }} />
        <KPI i="checkc" label="Verified" val={by('verified').length} sub="closed this release" tone="ok" style={{ flex: 1 }} />
      </Row>

      <Row className="g-rs" style={{ alignItems: 'flex-start' }}>
        {COLS.map(([st, l, tone]) => (
          <Col
            key={st}
            g={10}
            style={{ flex: 1, background: C.bg2, borderRadius: 12, padding: 12, minHeight: 120 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drag && move(drag, st)}
          >
            <Row g={8} className="g-ac">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: TONE[tone][1] }} />
              <b style={{ fontSize: 13, flex: 1 }}>{l}</b>
              <Chip s={10.5}>{by(st).length}</Chip>
            </Row>
            {by(st).map((b) => (
              <div
                key={b._id}
                className="g-card"
                draggable
                onDragStart={() => setDrag(b)}
                onClick={() => setEdit({ ...b, assignee: b.assignee || '' })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setEdit({ ...b, assignee: b.assignee || '' })}
                style={{ padding: 12, gap: 8, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}
              >
                <Row className="g-sb g-ac">
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: C.mut }}>{b.code}</span>
                  <Chip tone={SEV[b.severity]} s={10}>
                    {b.severity}
                  </Chip>
                </Row>
                <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: '18px' }}>{b.title}</span>
                <Row g={6} className="g-ac">
                  <Chip s={10}>{b.module || '—'}</Chip>
                  <span style={{ flex: 1 }} />
                  {b.assigneeName ? <Av name={b.assigneeName} col={C.ind} s={22} /> : <span className="g-s11 g-fa">unassigned</span>}
                </Row>
              </div>
            ))}
          </Col>
        ))}
      </Row>

      <Card title="Bugs by release" i="flag">
        <Table
          cols={[
            ['Release', 'f'],
            ['Found', 80],
            ['Open', 80],
            ['Critical / High open', 160],
            ['Promotion', 210],
          ]}
          rows={d.byRelease.map((r) => {
            const [l, t] = promo(r);
            return [
              r.version,
              String(r.found),
              String(r.open),
              String(r.ch),
              <Chip tone={t} dot>
                {l}
              </Chip>,
            ];
          })}
          empty="No releases yet — create one in Release Pipeline."
        />
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} label="Bug" width={560}>
        {edit && (
          <>
            <b style={{ fontSize: 16 }}>{edit._id ? `${edit.code}` : 'Report bug'}</b>
            <Field label="Title" htmlFor="b-t">
              <input id="b-t" className="g-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Steps / details" htmlFor="b-d">
              <textarea id="b-d" className="g-input" rows={4} value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            </Field>
            <Row g={10}>
              <Field label="Severity" htmlFor="b-s">
                <select id="b-s" className="g-input" value={edit.severity} onChange={(e) => setEdit({ ...edit, severity: e.target.value })}>
                  {['Critical', 'High', 'Medium', 'Low'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Module" htmlFor="b-m">
                <select id="b-m" className="g-input" value={edit.module || ''} onChange={(e) => setEdit({ ...edit, module: e.target.value })}>
                  {MODULES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </Row>
            <Row g={10}>
              <Field label="Found in release" htmlFor="b-r">
                <select id="b-r" className="g-input" value={edit.release || ''} onChange={(e) => setEdit({ ...edit, release: e.target.value })}>
                  <option value="">—</option>
                  {d.releases.map((r) => (
                    <option key={r.version}>{r.version}</option>
                  ))}
                </select>
              </Field>
              <Field label="Assignee" htmlFor="b-a">
                <select id="b-a" className="g-input" value={edit.assignee || ''} onChange={(e) => setEdit({ ...edit, assignee: e.target.value })}>
                  <option value="">Unassigned</option>
                  {d.team.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
            </Row>
            {edit._id && (
              <Field label="Status" htmlFor="b-st">
                <select id="b-st" className="g-input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {COLS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {edit.history && edit.history.length > 0 && (
              <Col g={2}>
                {edit.history.slice(-4).map((h, i) => (
                  <span key={i} className="g-s115 g-mut">
                    {new Date(h.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {h.by}: {h.from} → {h.to}
                  </span>
                ))}
              </Col>
            )}
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setEdit(null)}>
                Cancel
              </Btn>
              <Btn k="p" i="check" onClick={save} disabled={busy || !edit.title}>
                Save
              </Btn>
            </Row>
          </>
        )}
      </Modal>
    </Screen>
  );
}
