import React, { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, IB, Chip, Btn, Av, Card, Row, KPI, Field, Table, Toggle, Slider, Lbl, KV, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 1B "Hire-readiness scoring & batch leaderboard" (Admin; Support sees it read-only).

const W = [
  ['attendance', 'Attendance', 'cal', C.pri],
  ['assessment', 'Assessment', 'checkc', C.pu],
  ['coding', 'Coding', 'code', C.ind],
  ['project', 'Project', 'folder', C.ok],
];
const DEF = { attendance: 15, assessment: 30, coding: 30, project: 25 };
const nth = (n) => (n == null ? '—' : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`);

function csv(rows, name) {
  const head = ['Rank', 'Learner', 'Attendance', 'Assessment', 'Coding', 'Project', 'Score', 'Percentile', 'Level'];
  const body = rows.map((r) => [r.rank, r.name, r.attendance, r.assessment, r.coding, r.project, r.total, r.percentile, r.level.label]);
  const text = [head, ...body].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
}

export default function Scoring360() {
  const cfgQ = useData(() => api.config(), []);
  const [batch, setBatch] = useState('');
  const lbQ = useData(() => api.leaderboard(batch || undefined), [batch]);
  const [f, setF] = useState(null);
  const [scope, setScope] = useState(''); // '' = all batches, else the batch being overridden
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cfgQ.data) setF(JSON.parse(JSON.stringify(cfgQ.data)));
  }, [cfgQ.data]);
  useEffect(() => {
    if (!batch && lbQ.data && lbQ.data.batches.length) setBatch(lbQ.data.batches[0]);
  }, [lbQ.data, batch]);

  const override = useMemo(() => (f && scope ? (f.batchWeights || []).find((b) => b.batch === scope) : null), [f, scope]);
  if (cfgQ.loading && !f) return <Loading />;
  if (cfgQ.error) return <ErrorBox text={cfgQ.error} />;
  if (!f) return null;
  const canEdit = !!f.canEdit;
  const weights = scope ? (override ? override.weights : f.weights) : f.weights;
  const total = W.reduce((s, [k]) => s + (Number(weights[k]) || 0), 0);
  const setW = (k, v) => {
    const val = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    if (!scope) return setF({ ...f, weights: { ...f.weights, [k]: val } });
    const list = [...(f.batchWeights || [])];
    const i = list.findIndex((b) => b.batch === scope);
    const nw = { ...(i >= 0 ? list[i].weights : f.weights), [k]: val };
    if (i >= 0) list[i] = { batch: scope, weights: nw };
    else list.push({ batch: scope, weights: nw });
    setF({ ...f, batchWeights: list });
  };
  const clearOverride = () => setF({ ...f, batchWeights: (f.batchWeights || []).filter((b) => b.batch !== scope) });
  const save = async () => {
    if (total !== 100) return message.error('Weights must total 100%.');
    setBusy(true);
    const r = await api.saveConfig({ weights: f.weights, batchWeights: f.batchWeights, levels: f.levels, realtime: f.realtime, mentorPdf: f.mentorPdf });
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      cfgQ.reload();
      lbQ.reload();
      if (batch) api.leaderboard(batch, true).then(() => lbQ.reload());
    } else message.error(r.message);
  };
  const reset = () => setF({ ...f, weights: { ...DEF }, batchWeights: [], levels: { jobReady: 80, almost: 60 } });

  const lb = lbQ.data;
  const k = lb ? lb.kpis : null;
  const share = (n) => (k && k.n ? `${Math.round((n / k.n) * 100)}%` : '—');

  return (
    <Screen
      crumb="LMS / 360° & Scoring"
      title="360° Scoring Settings"
      actions={
        canEdit ? (
          <>
            <Btn k="s" i="undo" onClick={reset} disabled={busy}>
              Reset to default
            </Btn>
            <Btn k="p" i="refresh" onClick={save} disabled={busy || total !== 100}>
              {busy ? 'Saving…' : 'Save & recalculate'}
            </Btn>
          </>
        ) : (
          <Chip tone="pu" i="eye">
            Support · read-only
          </Chip>
        )
      }
    >
      <Row className="g-rs">
        <KPI i="target" label="Avg hire-readiness" val={k && k.avg != null ? k.avg : '—'} sub={k && k.delta != null ? `${k.delta >= 0 ? '+' : ''}${k.delta} vs last month` : batch ? `Batch ${batch}` : 'All batches'} tone="pri" bar={k ? k.avg || 0 : 0} style={{ flex: 1 }} />
        <KPI i="checkc" label="Job Ready" val={k ? k.jobReady : '—'} sub={`${share(k ? k.jobReady : 0)} of ${batch ? 'batch' : 'learners'}`} tone="ok" bar={k && k.n ? (k.jobReady / k.n) * 100 : 0} style={{ flex: 1 }} />
        <KPI i="clock" label="Almost Ready" val={k ? k.almost : '—'} sub={`${share(k ? k.almost : 0)} of ${batch ? 'batch' : 'learners'}`} tone="wa" bar={k && k.n ? (k.almost / k.n) * 100 : 0} style={{ flex: 1 }} />
        <KPI i="alert" label="Needs Improvement" val={k ? k.needs : '—'} sub={`${share(k ? k.needs : 0)} · mentors alerted`} tone="er" bar={k && k.n ? (k.needs / k.n) * 100 : 0} style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm">
        <Card title="Component weights" i="settings" sub="Must total 100% · applied to all batches unless overridden" style={{ flex: 1 }}>
          {W.map(([key, l, ic, col]) => (
            <Row key={key} g={14} className="g-ac" style={{ padding: '6px 0' }}>
              <IB n={ic} box={32} s={16} bg={C.bg2} c={col} />
              <span style={{ fontSize: 13, fontWeight: 600, width: 110, flexShrink: 0 }}>{l}</span>
              <div style={{ flex: 1, maxWidth: 300 }}>
                <Slider value={Math.min(40, weights[key])} max={40} col={col} onChange={(v) => canEdit && setW(key, v)} label={`${l} weight`} />
              </div>
              <div className="g-input" style={{ width: 72, padding: '6px 10px', justifyContent: 'center' }}>
                <input type="number" min={0} max={100} value={weights[key]} disabled={!canEdit} onChange={(e) => setW(key, e.target.value)} style={{ width: 30, textAlign: 'right', fontWeight: 600 }} aria-label={`${l} weight %`} />
                <b style={{ fontSize: 13 }}>%</b>
              </div>
            </Row>
          ))}
          <Row className="g-sb g-ac" style={{ background: total === 100 ? C.okL : C.erL, borderRadius: 8, padding: '10px 12px' }}>
            <b style={{ fontSize: 13, color: total === 100 ? C.okD : C.erD }}>Total</b>
            <b style={{ fontSize: 13, color: total === 100 ? C.okD : C.erD }}>{total} % {total === 100 ? ' ✓ valid' : ' ✗ must be 100'}</b>
          </Row>
          <Row g={12} className="g-rm">
            <Field label="Apply to" htmlFor="w-scope">
              <div className="g-input">
                <IB n="layers" box={18} s={15} bg="transparent" c={C.fa} />
                <select id="w-scope" value={scope} onChange={(e) => setScope(e.target.value)}>
                  <option value="">All batches</option>
                  {(f.batches || []).map((b) => (
                    <option key={b} value={b}>
                      {b} (override)
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Batch override">
              <div className="g-input">
                <IB n="edit" box={18} s={15} bg="transparent" c={C.fa} />
                <span style={{ flex: 1 }}>{scope ? `${scope} — ${override ? 'custom weights' : 'none (uses all-batch weights)'}` : `${(f.batchWeights || []).length} batch override${(f.batchWeights || []).length === 1 ? '' : 's'}`}</span>
                {scope && override && canEdit && (
                  <Btn k="g" sm onClick={clearOverride}>
                    Clear
                  </Btn>
                )}
              </div>
            </Field>
          </Row>
        </Card>

        <Card title="Readiness levels & rules" i="flag" sub="Colour codes shown on every report" style={{ width: 400, flexShrink: 0 }}>
          {[
            ['Job Ready', 'ok', 'jobReady', 100],
            ['Almost Ready', 'wa', 'almost', f.levels.jobReady - 1],
            ['Needs Improvement', 'er', null, f.levels.almost - 1],
          ].map(([l, tone, key, hi]) => (
            <Row key={l} g={10} className="g-ac" style={{ background: TONE[tone][0], borderRadius: 10, padding: '10px 12px' }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: TONE[tone][1], flexShrink: 0 }} />
              <b style={{ fontSize: 13, color: TONE[tone][1], flex: 1 }}>{l}</b>
              <span style={{ background: C.w, borderRadius: 6, padding: '4px 8px', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {key ? (
                  <input
                    type="number"
                    value={f.levels[key]}
                    disabled={!canEdit}
                    min={key === 'almost' ? 0 : 1}
                    max={key === 'almost' ? 99 : 100}
                    onChange={(e) => setF({ ...f, levels: { ...f.levels, [key]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
                    style={{ width: 34, border: 0, fontWeight: 600, textAlign: 'right', background: 'transparent' }}
                    aria-label={`${l} starts at`}
                  />
                ) : (
                  '0'
                )}
                {` – ${hi}`}
              </span>
            </Row>
          ))}
          <Lbl>Sub-score rules</Lbl>
          <KV k="Attendance" v="attended 70 · on-time 20 · live 10" />
          <KV k="Assessment" v="avg of test · micro · unit" />
          <KV k="Coding" v="solved 40 · tests 30 · quality 20 · tries 10" />
          <KV k="Project" v="mentor rubric score (2E)" />
          <Row g={10} className="g-ac">
            <span style={{ fontSize: 12.5, flex: 1 }}>Recalculate in real time on every score event</span>
            <Toggle on={f.realtime} disabled={!canEdit} onChange={(v) => setF({ ...f, realtime: v })} label="Real-time recalculation" />
          </Row>
        </Card>
      </Row>

      <Row className="g-rm">
        <Card
          title="Batch leaderboard · rank & percentile"
          i="trophy"
          sub={batch ? `${batch} · ${lb ? lb.rows.length : 0} learners` : 'Pick a batch'}
          style={{ flex: 1 }}
          right={
            <Row g={8} style={{ width: 'auto' }}>
              <div className="g-input" style={{ padding: '6px 10px', width: 'auto' }}>
                <select value={batch} onChange={(e) => setBatch(e.target.value)} aria-label="Batch" style={{ fontWeight: 600, fontSize: 12 }}>
                  {(lb ? lb.batches : []).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
              <Btn k="s" sm i="download" onClick={() => lb && csv(lb.rows, `leaderboard-${batch}.csv`)} disabled={!lb || !lb.rows.length}>
                Export
              </Btn>
            </Row>
          }
        >
          {lbQ.loading && !lb ? (
            <div className="g-empty">Ranking the batch…</div>
          ) : (
            <Table
              cols={[
                ['#', 34],
                ['Learner', 'f'],
                ['Att.', 46],
                ['Asmt', 48],
                ['Code', 48],
                ['Proj', 48],
                ['Score', 54],
                ['Pctl', 50],
                ['Level', 128],
              ]}
              rows={(lb ? lb.rows : []).map((r) => [
                r.rank || '—',
                <>
                  <Av name={r.name} s={24} />
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{r.name}</span>
                </>,
                r.attendance ?? '—',
                r.assessment ?? '—',
                r.coding ?? '—',
                r.project ?? '—',
                <b style={{ fontSize: 13 }}>{r.total == null ? '—' : Math.round(r.total)}</b>,
                nth(r.percentile),
                <Chip tone={r.level.tone} dot>
                  {r.level.key === 'needs' ? 'Needs Work' : r.level.label}
                </Chip>,
              ])}
              empty="No learners with scores in this batch yet."
            />
          )}
        </Card>
        <Card title="Role-based visibility" i="eye" sub="Who can see which 360° reports" style={{ width: 400, flexShrink: 0 }}>
          <Table
            cols={[
              ['Role', 'f'],
              ['Can see', 170],
            ]}
            rows={[
              ['Learner', 'Own report only', 'pri'],
              ['Mentor / Teacher', 'Assigned learners', 'ind'],
              ['Support', 'All · read-only', 'pu'],
              ['Admin', 'All · edits weights', 'er'],
              ['Recruiter', 'Shared link only', 'sky'],
            ].map(([a, b, t]) => [
              a,
              <Chip tone={t} s={11}>
                {b}
              </Chip>,
            ])}
          />
          <Row g={10} className="g-ac">
            <span style={{ fontSize: 12.5, flex: 1 }}>Mentors may download PDFs of assigned learners</span>
            <Toggle on={f.mentorPdf} disabled={!canEdit} onChange={(v) => setF({ ...f, mentorPdf: v })} label="Mentor PDF downloads" />
          </Row>
        </Card>
      </Row>
    </Screen>
  );
}
