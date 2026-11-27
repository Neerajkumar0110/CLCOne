import React, { useState } from 'react';
import { Input, Modal, Switch, Tooltip, Button, Progress } from 'antd';
import {
  ThunderboltOutlined, SearchOutlined, ClockCircleOutlined, UserOutlined, ArrowRightOutlined, CheckCircleOutlined,
  PauseCircleOutlined, ToolOutlined, ApiOutlined, RobotOutlined, NodeIndexOutlined, CodeOutlined, WarningOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, act, Loading, fmtTime } from './shared';
import './mgmt.css';
import './automation.css';

// Design A8 · Automation catalogue — the 16 spec §17.1 workflows plus the gap-fix rules (duplicate classes, approved-request follow-through). Running /
// Paused is the real state of the background job; workflows with no job yet
// say so instead of showing a toggle that does nothing.
// 2026-11-27 redesign: gradient hero + phase stepper, filterable workflow
// cards (trigger → action → human control), full detail in a modal.
const PHASES = [
  ['Phase 1', 'Map', 'templates, rules, owners', NodeIndexOutlined, 'done'],
  ['Phase 2', 'Quick wins', 'reminders, onboarding, daily report', ThunderboltOutlined, 'now'],
  ['Phase 3', 'Integrations', 'WhatsApp, dashboards', ApiOutlined, ''],
  ['Phase 4', 'Assisted AI', 'FAQ suggest, summaries', RobotOutlined, ''],
];
const stateOf = (r) => (!r.automated ? 'manual' : r.running ? 'running' : 'paused');

export default function Automation() {
  const { data, loading, err, setData } = useLoad(() => lmsApi.opsAutomation());
  const [f, setF] = useState('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState(null);
  const toggle = async (r) => {
    const res = await act(lmsApi.opsAutomationToggle(r.key, !r.running), r.running ? 'Paused' : 'Resumed');
    if (res) setData(res);
  };

  const rows = (data && data.rows) || [];
  const n = rows.reduce((m, r) => ({ ...m, [stateOf(r)]: (m[stateOf(r)] || 0) + 1 }), {});
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (f === 'all' || stateOf(r) === f || (f === 'failed' && r.lastResult && !r.lastResult.ok)) && (!needle || `${r.n} ${r.t} ${r.a} ${r.h} ${r.job || ''}`.toLowerCase().includes(needle)));
  const failed = rows.filter((r) => r.lastResult && !r.lastResult.ok).length;
  const v = view ? rows.find((r) => r.key === view) : null;
  const pct = data && data.total ? Math.round((data.running / data.total) * 100) : 0;

  const SwitchFor = ({ r }) => (!r.automated ? (
    <span className="mg-pill none">Manual</span>
  ) : (
    <Tooltip title={!r.pausable ? 'Part of the live-class job — always on' : !data.canToggle ? 'Only an LMS admin can pause' : r.running ? 'Pause this rule' : 'Resume this rule'}>
      <span onClick={(e) => e.stopPropagation()} className={`au-sw ${r.running ? 'on' : 'off'}`}>
        <Switch size="small" checked={r.running} disabled={!r.pausable || !data.canToggle} onChange={() => toggle(r)} />
        <b>{r.running ? 'Running' : 'Paused'}</b>
      </span>
    </Tooltip>
  ));

  return (
    <div className="mg au">
      <div className="mg-hero au-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><ThunderboltOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Automation catalogue · spec §17.1</span>
            <h1>Routine work runs itself</h1>
            <p>Every rule is idempotent and logged — and a final adverse decision is always made by a person, never by automation.</p>
          </div>
        </div>
        {data && (
          <div className="au-ring">
            <Progress type="circle" size={88} percent={pct} strokeWidth={9} strokeColor={{ '0%': '#a7f3d0', '100%': '#22c55e' }} trailColor="rgba(255,255,255,.25)" format={() => <span className="au-ring-t"><b>{data.running}/{data.total}</b><small>running</small></span>} />
          </div>
        )}
      </div>

      <div className="au-phases">
        {PHASES.map(([p, t, d, Ic, st], i) => (
          <div key={p} className={`au-ph ${st}`}>
            <span className="au-ph-ic"><Ic /></span>
            <div style={{ minWidth: 0 }}>
              <small>{p}{st === 'now' && <span className="au-now">Now</span>}{st === 'done' && <CheckCircleOutlined className="au-done" />}</small>
              <b>{t}</b>
              <span>{d}</span>
            </div>
            {i < PHASES.length - 1 && <ArrowRightOutlined className="au-ph-arrow" />}
          </div>
        ))}
      </div>

      <Loading loading={loading} err={err} data={data}>
        {data && (
          <>
            <div className="au-tools">
              <Input allowClear prefix={<SearchOutlined />} placeholder="Search workflow, trigger, job…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
              <div className="au-pills">
                {[['all', 'All', rows.length], ['running', 'Running', n.running || 0], ['paused', 'Paused', n.paused || 0], ['manual', 'Manual', n.manual || 0], ...(failed ? [['failed', 'Last run failed', failed]] : [])].map(([k, l, c]) => (
                  <button key={k} type="button" className={`au-pill ${k}${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} <i>{c}</i></button>
                ))}
              </div>
            </div>

            {shown.length === 0 ? <div className="mg-card"><div className="mg-empty">No workflow matches.</div></div> : (
              <div className="au-grid">
                {shown.map((r) => {
                  const st = stateOf(r);
                  const bad = r.lastResult && !r.lastResult.ok;
                  return (
                    <article key={r.key} className={`au-card ${st}${bad ? ' bad' : ''}`} role="button" tabIndex={0} onClick={() => setView(r.key)} onKeyDown={(e) => { if (e.key === 'Enter') setView(r.key); }}>
                      <div className="au-card-hd">
                        <span className={`au-card-ic ${st}`}>{st === 'running' ? <ThunderboltOutlined /> : st === 'paused' ? <PauseCircleOutlined /> : <ToolOutlined />}</span>
                        <b>{r.n}</b>
                        <SwitchFor r={r} />
                      </div>
                      <div className="au-flow">
                        <div><small>When</small><span>{r.t}</span></div>
                        <ArrowRightOutlined className="au-flow-arrow" />
                        <div><small>Then</small><span>{r.a}</span></div>
                      </div>
                      <div className="au-human"><UserOutlined /> <span>{r.h}</span></div>
                      <div className="au-foot">
                        {r.job ? (
                          <>
                            <span className="au-job"><CodeOutlined /> {r.job}</span>
                            <span className="au-run">{r.schedule ? <><ClockCircleOutlined /> {r.schedule}</> : null}{r.lastRun ? ` · ${fmtTime(r.lastRun)}` : ''}</span>
                          </>
                        ) : <span className="mg-pill none">Not built</span>}
                      </div>
                      {r.lastResult && <div className={`au-res${bad ? ' bad' : ''}`}>{bad ? <WarningOutlined /> : <CheckCircleOutlined />} <span>{r.lastResult.summary}</span></div>}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Loading>

      <Modal open={!!v} onCancel={() => setView(null)} footer={null} width={680} centered destroyOnClose rootClassName="mg-modal">
        {v && (
          <div className="mg-m">
            <div className="mg-m-head au-m-head">
              <span className="mg-act">{stateOf(v) === 'running' ? 'Running' : stateOf(v) === 'paused' ? 'Paused' : 'Manual'}</span>
              <h3>{v.n}</h3>
              <span>{v.job ? <>Job <b>{v.job}</b>{v.schedule ? ` · ${v.schedule}` : ''}</> : 'No background job — done by a person'}</span>
            </div>
            <div className="mg-m-body">
              <div className="au-m-flow">
                <div className="au-m-step"><i className="g3">1</i><div><small>Trigger</small><span>{v.t}</span></div></div>
                <div className="au-m-step"><i className="g2">2</i><div><small>Automated action</small><span>{v.a}</span></div></div>
                <div className="au-m-step"><i className="g5">3</i><div><small>Human control</small><span>{v.h}</span></div></div>
              </div>
              {v.lastRun && <><div className="mg-m-cap">Last run</div><div className="mg-m-box">{new Date(v.lastRun).toLocaleString('en-IN')}</div></>}
              {v.lastResult && (
                <>
                  <div className="mg-m-cap">Result</div>
                  <div className={`mg-m-box au-m-res${v.lastResult.ok ? '' : ' bad'}`}>{v.lastResult.summary}</div>
                </>
              )}
            </div>
            <div className="mg-m-foot au-m-foot">
              <SwitchFor r={v} />
              <Button type="primary" onClick={() => setView(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
