import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, Chip, Btn, Card, Row, KPI, KV, Table, Line, Bars, Modal, Field, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 4C "Automated tests, test cases & run reports" (QA / dev team).

const sec = (ms) => (ms == null ? '—' : ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const PRI = { Critical: 'er', High: 'or', Medium: 'sky', Low: 'mut' };
const RES = { Passed: 'ok', Failed: 'er', Flaky: 'wa', 'Not run': 'mut' };

export default function QaTests() {
  const { data: d, error, loading, reload } = useData(() => api.qaRuns(), []);
  const [mod, setMod] = useState('');
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!d || !d.running) return undefined;
    const iv = setInterval(reload, 3000);
    return () => clearInterval(iv);
  }, [d, reload]);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const L = d.latest;
  const s = (L && L.suites) || {};
  const pct = (x) => (x && x.total ? Math.round((x.passed / x.total) * 100) : null);
  const kpi = (x) => (x && x.total ? `${pct(x)}% passed · ${sec(x.ms)}` : 'not run yet');
  const runs = d.runs.filter((r) => r.status === 'done');
  const passSeries = runs.map((r) => {
    const t = ['unit', 'integration', 'e2e'].reduce((a, k) => a + ((r.suites && r.suites[k] && r.suites[k].total) || 0), 0);
    const p = ['unit', 'integration', 'e2e'].reduce((a, k) => a + ((r.suites && r.suites[k] && r.suites[k].passed) || 0), 0);
    return t ? Math.round((p / t) * 100) : null;
  });
  const modules = [...new Set(d.cases.map((c) => c.module).filter(Boolean))];
  const cases = d.cases.filter((c) => !mod || c.module === mod);
  const total = L ? (L.results || []).length : 0;
  const passed = L ? (L.results || []).filter((r) => r.ok).length : 0;
  const flaky = L ? (L.results || []).filter((r) => r.flaky).length : 0;
  const start = async () => {
    setBusy(true);
    const r = await api.qaStartRun();
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
    } else message.error(r.message);
  };
  const download = () => {
    if (!L) return;
    const lines = [`Run #${L.number}`, `Release: ${L.release || '—'}`, `Started: ${new Date(L.startedAt).toISOString()}`, `Duration: ${sec(L.durationMs)}`, `Load: ${s.load ? `${s.load.requests} req · ${s.load.users} users · p95 ${s.load.p95} ms · ${s.load.errorPct}% errors` : '—'}`, '', ...(L.results || []).map((r) => `${r.ok ? (r.flaky ? 'FLAKY' : 'PASS ') : 'FAIL '} [${r.suite}] ${r.id} — ${r.name} (${r.ms} ms)${r.error ? ` · ${r.error}` : ''}`)];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    a.download = `test-run-${L.number}.txt`;
    a.click();
  };

  return (
    <Screen
      qa
      crumb="LMS / Test Runs"
      title="Test runs"
      actions={
        <Btn k="p" i="play" onClick={start} disabled={busy || d.running}>
          {d.running ? 'Running…' : 'Run all suites'}
        </Btn>
      }
    >
      <Row className="g-rs">
        <KPI i="code" label="Unit" val={s.unit ? s.unit.total : '—'} sub={kpi(s.unit)} tone={s.unit && s.unit.failed ? 'er' : 'ok'} bar={pct(s.unit) ?? 0} style={{ flex: 1 }} />
        <KPI i="layers" label="Integration" val={s.integration ? s.integration.total : '—'} sub={kpi(s.integration)} tone={s.integration && s.integration.failed ? 'er' : 'ok'} bar={pct(s.integration) ?? 0} style={{ flex: 1 }} />
        <KPI i="globe" label="End-to-end" val={s.e2e ? s.e2e.total : '—'} sub={kpi(s.e2e)} tone={s.e2e && s.e2e.failed ? 'er' : 'ok'} bar={pct(s.e2e) ?? 0} style={{ flex: 1 }} />
        <KPI i="zap" label="Load" val={s.load ? `p95 ${s.load.p95} ms` : '—'} sub={s.load ? `${s.load.users} users · ${s.load.errorPct}% errors` : 'not run yet'} tone="sky" style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title={`Pass rate · last ${runs.length} run${runs.length === 1 ? '' : 's'}`} i="activity" sub={runs.length ? `Run #${runs[0].number} – #${runs[runs.length - 1].number}` : 'No runs yet'} style={{ flex: 1 }}>
          {runs.length > 1 ? (
            <Line series={[{ d: passSeries, c: C.ok, area: true, dots: true, l: 'Pass %' }]} w={620} h={170} min={Math.max(0, Math.min(80, ...passSeries.filter((x) => x != null)) - 5)} max={100} xl={runs.map((r, i) => (i === 0 || i === runs.length - 1 || i % 3 === 0 ? `#${r.number}` : ''))} legend />
          ) : (
            <div className="g-empty">Run the suites a couple of times to see the trend.</div>
          )}
        </Card>
        <Card title={L ? `Run #${L.number} report` : 'Run report'} i="file" sub={L ? `${L.release || 'no release'} · ${sec(L.durationMs)} · triggered by ${L.trigger}${L.by ? ` (${L.by})` : ''}` : '—'} style={{ width: 420, flexShrink: 0 }}>
          {L ? (
            <>
              <KV k="Total" v={`${total} tests`} />
              <KV k="Passed" v={String(passed)} c={C.okD} />
              <KV k="Failed" v={String(total - passed)} c={total - passed ? C.erD : undefined} />
              <KV k="Flaky (auto-retried)" v={String(flaky)} c={C.waD} />
              <KV k="Coverage (checks with a test case)" v={L.coverage != null ? `${L.coverage}%` : '—'} />
              <Bars d={[(s.unit || {}).passed || 0, (s.integration || {}).passed || 0, (s.e2e || {}).passed || 0]} w={380} h={90} c={C.ok} xl={['Unit', 'Integration', 'E2E']} />
              {(L.results || [])
                .filter((r) => !r.ok)
                .map((r) => (
                  <span key={r.id} style={{ fontSize: 11.5, color: C.erD }}>
                    ✗ {r.id}: {r.error}
                  </span>
                ))}
              <span>
                <Btn k="s" i="download" onClick={download}>
                  Download report
                </Btn>
              </span>
            </>
          ) : (
            <div className="g-empty">No run yet — press Run all suites.</div>
          )}
        </Card>
      </Row>

      <Card
        title="Test case management"
        i="list"
        right={
          <Row g={8} style={{ width: 'auto' }}>
            <div className="g-input" style={{ width: 'auto', padding: '5px 10px' }}>
              <select value={mod} onChange={(e) => setMod(e.target.value)} aria-label="Module" style={{ fontSize: 12, fontWeight: 600 }}>
                <option value="">Module: All</option>
                {modules.map((m) => (
                  <option key={m} value={m}>
                    Module: {m}
                  </option>
                ))}
              </select>
            </div>
            <Btn k="g" sm i="plus" onClick={() => setEdit({ title: '', module: '', type: 'Manual', priority: 'Medium', steps: '' })}>
              New test case
            </Btn>
          </Row>
        }
      >
        <Table
          cols={[
            ['ID', 76],
            ['Test case', 'f'],
            ['Module', 120],
            ['Type', 100],
            ['Priority', 86],
            ['Last result', 106],
            ['Release', 120],
          ]}
          onRow={(i) => setEdit({ ...cases[i] })}
          rows={cases.map((c) => [
            c.code,
            c.title,
            c.module || '—',
            <Chip s={10.5}>{c.type}</Chip>,
            <Chip tone={PRI[c.priority]} s={10.5}>
              {c.priority}
            </Chip>,
            <Chip tone={RES[c.lastResult]} dot>
              {c.lastResult}
            </Chip>,
            c.release || (c.lastRun ? `run #${c.lastRun}` : '—'),
          ])}
          empty="No test cases."
        />
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} label="Test case">
        {edit && (
          <>
            <b style={{ fontSize: 16 }}>{edit._id ? `${edit.code} · edit` : 'New test case'}</b>
            <Field label="Test case" htmlFor="tc-t">
              <input id="tc-t" className="g-input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} disabled={!!edit.check} />
            </Field>
            <Row g={10}>
              <Field label="Module" htmlFor="tc-m">
                <input id="tc-m" className="g-input" value={edit.module || ''} onChange={(e) => setEdit({ ...edit, module: e.target.value })} />
              </Field>
              <Field label="Type" htmlFor="tc-ty">
                <select id="tc-ty" className="g-input" value={edit.type} disabled={!!edit.check} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                  {['Manual', 'Unit', 'Integration', 'E2E', 'Load'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Priority" htmlFor="tc-p">
                <select id="tc-p" className="g-input" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                  {['Critical', 'High', 'Medium', 'Low'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            </Row>
            <Field label="Steps / expected result" htmlFor="tc-s">
              <textarea id="tc-s" className="g-input" rows={4} value={edit.steps || ''} onChange={(e) => setEdit({ ...edit, steps: e.target.value })} />
            </Field>
            {!edit.check && (
              <Field label="Result (manual case)" htmlFor="tc-r">
                <select id="tc-r" className="g-input" value={edit.lastResult || 'Not run'} onChange={(e) => setEdit({ ...edit, lastResult: e.target.value })}>
                  {['Not run', 'Passed', 'Failed', 'Flaky'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
            )}
            {edit.check && <span className="g-s12 g-mut">Automated — linked to check “{edit.check}”; its result comes from each run.</span>}
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setEdit(null)}>
                Cancel
              </Btn>
              <Btn
                k="p"
                i="check"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await api.qaSaveCase(edit._id, edit);
                  setBusy(false);
                  if (r.success) {
                    message.success(r.message);
                    setEdit(null);
                    reload();
                  } else message.error(r.message);
                }}
              >
                Save
              </Btn>
            </Row>
          </>
        )}
      </Modal>
    </Screen>
  );
}
