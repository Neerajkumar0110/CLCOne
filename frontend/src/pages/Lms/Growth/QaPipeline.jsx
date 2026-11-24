import React, { useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, I, IB, Chip, Btn, Av, Card, Row, Col, KV, Lbl, Toggle, Note, Modal, Field, Screen, Loading, ErrorBox, useData, ago } from './ui';

// Figma 4A "Release pipeline · Dev → QA → Production" (QA / dev team).

const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const up = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  return d ? `${d} d ${h} h` : `${h} h ${Math.floor((s % 3600) / 60)} m`;
};

function Env({ t, i, tone, ver, rows, st }) {
  return (
    <div className="g-card" style={{ flex: 1, padding: 18, gap: 10, borderColor: TONE[tone][1] }}>
      <Row g={10} className="g-ac">
        <IB n={i} tone={tone} />
        <Col g={0} style={{ flex: 1 }}>
          <b style={{ fontSize: 15 }}>{t}</b>
          <span className="g-s12 g-mut">{ver}</span>
        </Col>
        <Chip tone={st[1]} dot>
          {st[0]}
        </Chip>
      </Row>
      {rows.map(([k, v]) => (
        <KV key={k} k={k} v={v} />
      ))}
    </div>
  );
}

export default function QaPipeline() {
  const { data: d, error, loading, reload } = useData(() => api.qaOverview(), []);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState('QA');
  const [nr, setNr] = useState(null);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const s = d.server;
  const { dev, qa, prod } = d.envs;
  const rc = d.rc;
  const run = async (fn) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
    } else message.error(r.message);
  };
  const signed = (k) => rc && (rc.signoffs || []).find((x) => x.role === k);
  const waiting = rc ? d.signoffRoles.filter(([k]) => !(signed(k) && signed(k).decision === 'approved')).length : 0;
  const gatesOk = d.gates && d.gates.list.every((g) => g.ok);
  const canPromote = rc && gatesOk && waiting === 0;

  return (
    <Screen
      qa
      crumb="LMS / Release Pipeline"
      title="Release pipeline"
      actions={
        <Btn k="g" i="plus" onClick={() => setNr({ version: '', title: '', env: 'qa', checklist: 38 })}>
          New release
        </Btn>
      }
    >
      <Row g={12} className="g-ac g-rm">
        <Env
          t="Development"
          i="code"
          tone="ind"
          ver={dev ? `${dev.version} · ${dev.branch || 'main'} @ ${dev.commit || '—'}` : `${s.branch || 'main'} @ ${s.commit || '—'}`}
          rows={[
            ['Server', s.env === 'development' ? `${s.host} (this one)` : 'developer laptops'],
            ['Database', s.env === 'development' ? (s.dbSeparate ? 'separate dev DB' : 'shares production DB') : '—'],
            ['Ahead of remote', s.aheadOfRemote == null ? '—' : `${s.aheadOfRemote} commit${s.aheadOfRemote === 1 ? '' : 's'}`],
          ]}
          st={dev ? (dev.status === 'sent_back' ? ['Sent back', 'or'] : ['Building', 'ind']) : ['Idle', 'mut']}
        />
        <I n="chevr" c={C.fa} s={24} />
        <Env
          t="QA / Staging"
          i="shield"
          tone="wa"
          ver={qa ? `${qa.version} · deployed ${ago(qa.deployedQaAt)}` : 'no release in QA'}
          rows={[
            ['URL', 'clcone…:8443 (test site)'],
            ['Database', s.dbSeparate ? 'lms_qa (separate)' : 'shared with production'],
            ['Mirrors prod', 'same build · config · versions'],
          ]}
          st={qa ? (qa.status === 'signed_off' ? ['Signed off', 'ok'] : ['In QA', 'wa']) : ['Empty', 'mut']}
        />
        <I n="chevr" c={C.fa} s={24} />
        <Env
          t="Production"
          i="rocket"
          tone="pri"
          ver={prod ? `${prod.version} · live since ${fmt(prod.liveAt)}` : `v${s.version} · ${s.commit || '—'}`}
          rows={[
            ['URL', 'clcone.careerlab…'],
            ['Server', s.env === 'production' ? `${s.host} · up ${up(s.uptimeSec)}` : 'VPS'],
            ['Last commit', s.committedAt ? fmt(s.committedAt) : '—'],
          ]}
          st={['Live', 'pri']}
        />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title={rc ? `Release candidate ${rc.version}` : 'Release candidate'}
          i="flag"
          sub={rc ? rc.title || '—' : 'Create a release to start the pipeline'}
          style={{ flex: 1 }}
          right={rc && (waiting ? <Chip tone="wa" dot>{`Waiting for ${waiting} sign-off${waiting === 1 ? '' : 's'}`}</Chip> : <Chip tone="ok" dot>Signed off</Chip>)}
        >
          {rc && (
            <>
              <Lbl>Quality gates{d.gates && d.gates.run ? ` · run #${d.gates.run}` : ''}</Lbl>
              {d.gates.list.map((g) => (
                <Row key={g.key} g={10} className="g-ac">
                  <span style={{ width: 20, height: 20, borderRadius: 999, background: g.ok ? C.okL : C.erL, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <I n={g.ok ? 'check' : 'x'} c={g.ok ? C.ok : C.er} s={12} sw={3} />
                  </span>
                  <span style={{ fontSize: 12.5, flex: 1 }}>{g.label}</span>
                  {g.key === 'manual' && <Toggle on={!!rc.checklistDone} onChange={(v) => run(() => api.qaRelease(rc._id, 'checklist', { checklist: rc.checklist, done: v }))} label="Manual checklist done" />}
                </Row>
              ))}
              <Lbl>Sign-off</Lbl>
              <Row g={10} className="g-rm">
                {d.signoffRoles.map(([k, l]) => {
                  const x = signed(k);
                  const tone = x ? (x.decision === 'approved' ? 'ok' : 'er') : 'wa';
                  return (
                    <Row key={k} g={8} className="g-ac" style={{ flex: 1, background: C.bg, borderRadius: 10, padding: 10 }}>
                      <Av ini={k} col={TONE[tone][1]} s={28} />
                      <Col g={0}>
                        <b style={{ fontSize: 12 }}>{x ? x.name : l}</b>
                        <span style={{ fontSize: 11, color: TONE[tone][1] }}>{x ? `${x.decision === 'approved' ? 'Approved' : 'Rejected'} ${new Date(x.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Pending'}</span>
                      </Col>
                    </Row>
                  );
                })}
              </Row>
              <Row g={8} className="g-wrap" style={{ justifyContent: 'flex-end' }}>
                {rc.env !== 'qa' && (
                  <Btn k="s" i="shield" disabled={busy} onClick={() => run(() => api.qaRelease(rc._id, 'to-qa'))}>
                    Deploy to QA
                  </Btn>
                )}
                <Btn k="s" i="undo" disabled={busy} onClick={() => run(() => api.qaRelease(rc._id, 'send-back'))}>
                  Send back to dev
                </Btn>
                <select className="g-input" style={{ width: 'auto', padding: '7px 8px' }} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Approve as">
                  {d.signoffRoles.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <Btn k="ok" i="check" disabled={busy} onClick={() => run(() => api.qaRelease(rc._id, 'signoff', { role, decision: 'approve' }))}>
                  Approve ({role})
                </Btn>
                <Btn k="p" i="rocket" disabled={busy || !canPromote} onClick={() => run(() => api.qaRelease(rc._id, 'promote'))} title={canPromote ? '' : 'Unlocks when every gate passes and all three have signed off'}>
                  Promote to production
                </Btn>
              </Row>
              <Note tone="mut" i="terminal">
                Promote / roll back records the release here; the code is deployed with the deploy script on the server.
              </Note>
            </>
          )}
        </Card>

        <Col style={{ width: 400, flexShrink: 0 }}>
          <Card title="Rollback" i="undo" sub="Switch production back to a previous build">
            {d.rollback.length === 0 && <span className="g-s12 g-fa">No production releases recorded yet.</span>}
            {d.rollback.map((r) => {
              const cur = r.env === 'prod';
              return (
                <Row key={r._id} g={10} className="g-ac" style={{ background: cur ? C.priL : C.bg, borderRadius: 10, padding: 10 }}>
                  <I n="git" c={C.mut} s={16} />
                  <b style={{ fontSize: 12.5 }}>{r.version}</b>
                  <span style={{ fontSize: 12, color: C.mut, flex: 1 }}>{cur ? `Live · ${fmt(r.liveAt)}` : fmt(r.liveAt)}</span>
                  {cur ? (
                    <Chip tone="pri">Current</Chip>
                  ) : (
                    <Btn k="dd" sm i="undo" disabled={busy} onClick={() => window.confirm(`Roll production back to ${r.version}?`) && run(() => api.qaRelease(r._id, 'rollback'))}>
                      Roll back
                    </Btn>
                  )}
                </Row>
              );
            })}
            <Row g={10} className="g-ac">
              <span style={{ fontSize: 12, flex: 1 }}>Auto-rollback if error rate &gt; 2% for 10 min after deploy</span>
              <Toggle on={!!d.settings.autoRollback} onChange={(v) => run(() => api.qaSaveSettings({ autoRollback: v }))} label="Auto-rollback" />
            </Row>
          </Card>
          <Card title="Deploy history" i="clock">
            {d.history.length === 0 && <span className="g-s12 g-fa">Nothing yet.</span>}
            {d.history.map((h, i) => {
              const tone = /rolled back/i.test(h.text) ? 'er' : h.env === 'prod' ? 'pri' : h.env === 'qa' ? 'wa' : 'ind';
              return (
                <Row key={i} g={8} className="g-ac">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: TONE[tone][1], flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, flex: 1 }}>
                    {h.text}
                    {h.by ? <span className="g-fa"> · {h.by}</span> : null}
                  </span>
                  <span className="g-s115 g-mut">{ago(h.at)}</span>
                </Row>
              );
            })}
          </Card>
        </Col>
      </Row>

      <Modal open={!!nr} onClose={() => setNr(null)} label="New release">
        {nr && (
          <>
            <b style={{ fontSize: 16 }}>New release</b>
            <Field label="Version" htmlFor="nr-v">
              <input id="nr-v" className="g-input" value={nr.version} onChange={(e) => setNr({ ...nr, version: e.target.value })} placeholder="v2.14.0-rc.1" />
            </Field>
            <Field label="What's in it" htmlFor="nr-t">
              <input id="nr-t" className="g-input" value={nr.title} onChange={(e) => setNr({ ...nr, title: e.target.value })} placeholder="Learner 360°, project timers, engagement tracker" />
            </Field>
            <Row g={10}>
              <Field label="Starts in" htmlFor="nr-e">
                <select id="nr-e" className="g-input" value={nr.env} onChange={(e) => setNr({ ...nr, env: e.target.value })}>
                  <option value="dev">Development</option>
                  <option value="qa">QA (runs the suites)</option>
                </select>
              </Field>
              <Field label="Manual regression cases" htmlFor="nr-c">
                <input id="nr-c" type="number" className="g-input" value={nr.checklist} onChange={(e) => setNr({ ...nr, checklist: Number(e.target.value) || 0 })} />
              </Field>
            </Row>
            <span className="g-s12 g-mut">Commit and branch are taken from this server's git checkout.</span>
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setNr(null)}>
                Cancel
              </Btn>
              <Btn
                k="p"
                i="check"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  // created in Dev; "QA" then moves it (and starts the suites) in one go
                  const r = await api.qaCreateRelease({ ...nr, env: 'dev' });
                  if (r.success && nr.env === 'qa') await api.qaRelease(r.result._id, 'to-qa');
                  setBusy(false);
                  if (r.success) {
                    message.success(r.message);
                    setNr(null);
                    reload();
                  } else message.error(r.message);
                }}
              >
                Create
              </Btn>
            </Row>
          </>
        )}
      </Modal>
    </Screen>
  );
}
