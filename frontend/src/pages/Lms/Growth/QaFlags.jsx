import React, { useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, IB, Btn, Card, Row, Col, Table, Toggle, Slider, Tabs, Lbl, KV, Bars, Modal, Field, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 4E "Feature flags, access control & logs" (QA / dev team).

const LV_COLOR = { INFO: '#94a3b8', WARN: '#fbbf24', ERROR: '#f87171' };

export default function QaFlags() {
  const fq = useData(() => api.qaFlags(), []);
  const [lvl, setLvl] = useState('all');
  const lq = useData(() => api.qaLogs({ level: lvl === 'all' ? undefined : lvl === 'errors' ? 'ERROR' : 'WARN' }), [lvl]);
  const [nf, setNf] = useState(null);
  const [team, setTeam] = useState(null);
  const [busy, setBusy] = useState(false);
  if ((fq.loading && !fq.data) || (lq.loading && !lq.data)) return <Loading />;
  if (fq.error) return <ErrorBox text={fq.error} />;
  if (lq.error) return <ErrorBox text={lq.error} />;
  const F = fq.data;
  const Lg = lq.data;
  const st = Lg.settings;
  const saveFlag = async (id, body) => {
    setBusy(true);
    const r = await api.qaSaveFlag(id, body);
    setBusy(false);
    if (r.success) fq.reload();
    else message.error(r.message);
  };
  const saveSettings = async (body) => {
    setBusy(true);
    const r = await api.qaSaveSettings(body);
    setBusy(false);
    if (r.success) {
      message.success('Saved');
      lq.reload();
    } else message.error(r.message);
  };
  const ago = (d) => {
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    return days <= 0 ? 'today' : new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <Screen qa crumb="LMS / Feature Flags" title="Feature flags · access · monitoring">
      <Card
        title="Feature flags"
        i="toggle"
        sub={F.isQa ? 'This is the QA server — the QA column decides' : 'Production: rollout % within the audience · QA column applies on the QA server'}
        right={
          <Btn k="g" sm i="plus" onClick={() => setNf({ key: '', description: '', qa: true, rollout: 0, audience: 'all' })}>
            New flag
          </Btn>
        }
      >
        <Table
          cols={[
            ['Flag', 'f'],
            ['QA', 60],
            ['Production rollout', 240],
            ['Audience', 190],
            ['Updated', 90],
          ]}
          rows={F.flags.map((f) => [
            <Col g={0}>
              <b style={{ fontSize: 12.5 }}>{f.key}</b>
              <span className="g-s115 g-mut">{f.description}</span>
            </Col>,
            <Toggle on={f.qa} disabled={busy} onChange={(v) => saveFlag(f._id, { qa: v })} label={`${f.key} in QA`} />,
            <>
              <div style={{ width: 150 }}>
                <Slider value={f.rollout} col={f.rollout ? C.pri : '#cbd5e1'} onChange={(v) => saveFlag(f._id, { rollout: v })} label={`${f.key} rollout`} />
              </div>
              <b style={{ fontSize: 12 }}>{f.rollout}%</b>
            </>,
            <select className="g-input" style={{ padding: '5px 8px' }} value={f.audience || 'all'} disabled={busy} onChange={(e) => saveFlag(f._id, { audience: e.target.value })} aria-label={`${f.key} audience`}>
              <option value="all">All users</option>
              <option value="role:Student">Learners</option>
              <option value="role:Teacher">Mentors</option>
              {F.batches.map((b) => (
                <option key={b} value={`batch:${b}`}>
                  Batch {b}
                </option>
              ))}
            </select>,
            ago(f.updated),
          ])}
        />
      </Card>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="QA access control" i="shield" sub="Only dev & QA teams can open the QA site" style={{ width: 400, flexShrink: 0 }}>
          {[
            ['dev', 'code', 'Dev team', 'ind'],
            ['qa', 'bug', 'QA team', 'wa'],
          ].map(([k, ic, l, tone]) => (
            <Row key={k} g={10} className="g-ac" style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
              <IB n={ic} tone={tone} box={30} s={15} />
              <Col g={0} style={{ flex: 1 }}>
                <b style={{ fontSize: 12.5 }}>{l}</b>
                <span className="g-s115 g-mut">
                  {(st.teams[k] || []).length} member{(st.teams[k] || []).length === 1 ? '' : 's'}
                  {(st.teams[k] || []).length ? ` · ${st.teams[k].slice(0, 3).join(', ')}` : ''}
                </span>
              </Col>
              <Btn k="s" sm onClick={() => setTeam({ k, l, list: [...(st.teams[k] || [])] })}>
                Manage
              </Btn>
            </Row>
          ))}
          {[
            ['sso', 'Google SSO (company domain only)'],
            ['ipAllowlist', 'IP allowlist (office + VPN)'],
            ['noIndex', 'Block search-engine indexing'],
            ['guests', 'Allow guest reviewers'],
          ].map(([k, l]) => (
            <Row key={k} g={10} className="g-ac">
              <span style={{ fontSize: 12.5, flex: 1 }}>{l}</span>
              <Toggle on={!!st.access[k]} disabled={busy} onChange={(v) => saveSettings({ access: { ...st.access, [k]: v } })} label={l} />
            </Row>
          ))}
        </Card>

        <Card title={`Logs & error monitoring${Lg.run ? ` · run #${Lg.run}` : ''}`} i="terminal" style={{ flex: 1 }} right={<Tabs items={[['all', 'All'], ['errors', 'Errors'], ['warnings', 'Warnings']]} act={lvl} onChange={setLvl} />}>
          <Col g={4} style={{ background: C.ink, borderRadius: 10, padding: 14, maxHeight: 260, overflowY: 'auto', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' }}>
            {Lg.rows.length === 0 && <span style={{ fontSize: 11.5, color: '#94a3b8' }}>No log lines.</span>}
            {Lg.rows.map((r) => (
              <Row key={r._id} g={12}>
                <span style={{ fontSize: 11.5, color: '#64748b', flexShrink: 0 }}>{new Date(r.at).toLocaleTimeString('en-IN', { hour12: false })}</span>
                <b style={{ fontSize: 11.5, color: LV_COLOR[r.level], width: 48, flexShrink: 0 }}>{r.level}</b>
                <span style={{ fontSize: 11.5, color: '#e2e8f0', wordBreak: 'break-word' }}>{r.message}</span>
              </Row>
            ))}
          </Col>
          <Row g={16} className="g-rm">
            <Col g={6}>
              <Lbl>Errors per run</Lbl>
              {Lg.perRun.length ? (
                <Bars d={Lg.perRun.map((x) => x.n)} w={380} h={80} c={C.er} max={Math.max(1, ...Lg.perRun.map((x) => x.n))} xl={Lg.perRun.map((x, i) => (i === 0 || i === Lg.perRun.length - 1 ? `#${x.run}` : ''))} />
              ) : (
                <span className="g-s12 g-fa">No runs yet.</span>
              )}
            </Col>
            <Col g={6}>
              <Lbl>Top errors (7 days) · {Lg.errors24h} in last 24 h</Lbl>
              {Lg.top.length === 0 && <span className="g-s12 g-fa">No errors.</span>}
              {Lg.top.map((t) => (
                <KV key={t.key} k={<span style={{ fontSize: 12, color: C.mut, wordBreak: 'break-all' }}>{t.key}</span>} v={String(t.n)} />
              ))}
            </Col>
          </Row>
        </Card>
      </Row>

      <Modal open={!!nf} onClose={() => setNf(null)} label="New flag">
        {nf && (
          <>
            <b style={{ fontSize: 16 }}>New feature flag</b>
            <Field label="Key (snake_case)" htmlFor="f-k">
              <input id="f-k" className="g-input" value={nf.key} onChange={(e) => setNf({ ...nf, key: e.target.value })} placeholder="ai_proctoring_v2" />
            </Field>
            <Field label="What it turns on" htmlFor="f-d">
              <input id="f-d" className="g-input" value={nf.description} onChange={(e) => setNf({ ...nf, description: e.target.value })} />
            </Field>
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setNf(null)}>
                Cancel
              </Btn>
              <Btn
                k="p"
                i="check"
                disabled={busy || !nf.key}
                onClick={async () => {
                  await saveFlag(null, nf);
                  setNf(null);
                }}
              >
                Create (on in QA, 0% in production)
              </Btn>
            </Row>
          </>
        )}
      </Modal>

      <Modal open={!!team} onClose={() => setTeam(null)} label="Manage team">
        {team && (
          <>
            <b style={{ fontSize: 16 }}>{team.l}</b>
            {Lg.people.map((p) => (
              <label key={p} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={team.list.includes(p)} onChange={(e) => setTeam({ ...team, list: e.target.checked ? [...team.list, p] : team.list.filter((x) => x !== p) })} />
                {p}
              </label>
            ))}
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setTeam(null)}>
                Cancel
              </Btn>
              <Btn
                k="p"
                i="check"
                onClick={async () => {
                  await saveSettings({ teams: { ...st.teams, [team.k]: team.list } });
                  setTeam(null);
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
