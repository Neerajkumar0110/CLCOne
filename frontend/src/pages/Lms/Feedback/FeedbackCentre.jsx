import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Skeleton, Tooltip, message } from 'antd';
import {
  MessageOutlined, TeamOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined, BellOutlined,
  SafetyCertificateOutlined, ReloadOutlined, SendOutlined, CalendarOutlined, MailOutlined, StopOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import '../Policies/policyDesign.css';
import './feedback.css';

// Feedback centre for Support / management (design S8): the weekly schedule,
// response rate per batch per week (submitted ÷ active learners), who hasn't
// responded this week (remind, max 2 a week), low-scoring areas and — for
// management only — serious concerns.
// 2026-11-27: redesigned so the page explains itself — schedule strip, KPI
// cards, colour-coded heat-map with a legend, batch pills and per-learner chips.

const weekLabel = (k) => (k ? new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const tone = (p) => (p === null || p === undefined ? 'none' : p >= 80 ? 'ok' : p >= 60 ? 'mid' : 'bad');
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

export default function FeedbackCentre() {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState(undefined);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const r = await lmsApi.feedbackAdminOverview(8).catch(() => null);
    setD((r && r.success !== false && r.result) || null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const batches = useMemo(() => (d ? d.responseRate.map((b) => b.batch) : []), [d]);
  useEffect(() => {
    if (!batch && batches.length) setBatch(batches[0]);
  }, [batches, batch]);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 60 }} description="Could not load the feedback centre." />;

  const nonResp = d.nonRespondents.filter((n) => n.batch === batch);
  const missBy = d.nonRespondents.reduce((m, n) => ({ ...m, [n.batch]: (m[n.batch] || 0) + 1 }), {});
  const learners = d.responseRate.reduce((n, b) => n + (b.eligible || 0), 0);
  const focusIdx = d.weeks.indexOf(d.focusWeek);
  const focusSubmitted = focusIdx >= 0 ? d.responseRate.reduce((n, b) => n + ((b.weeks[focusIdx] || {}).submitted || 0), 0) : 0;
  const focusPct = focusIdx >= 0 && learners ? Math.round((focusSubmitted / learners) * 100) : null;
  const atRisk = d.nonRespondents.filter((n) => n.weeksMissing >= 3).length;

  const remind = async () => {
    setSending(true);
    const r = await lmsApi.feedbackAdminRemind(batch).catch(() => null);
    setSending(false);
    if (!r || r.success === false) {
      message.error((r && r.message) || 'Could not send reminders.');
      return;
    }
    message.success(r.message);
    load();
  };

  const sched = [
    [CalendarOutlined, 'Form opens', d.schedule.opens],
    [ClockCircleOutlined, 'Due', d.schedule.due],
    [WarningOutlined, 'Late submissions till', d.schedule.lateUntil],
    [BellOutlined, 'Reminders', `max ${d.schedule.maxReminders} / learner / week`],
  ];

  return (
    <div className="pol fbx" style={{ padding: 4 }}>
      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic"><MessageOutlined /></span>
          <div>
            <h2>Feedback centre</h2>
            <p>Every week each active learner fills a short feedback form (v{d.schedule.formVersion}). See which batches respond, remind the ones who haven&apos;t, and catch low scores or serious concerns early.</p>
          </div>
        </div>
        <div className="fbx-hero-r">
          {d.window ? (
            <span className="fbx-live on"><i /> Week of {weekLabel(d.window.weekKey)} is open</span>
          ) : (
            <span className="fbx-live"><i /> No week open · next opens {d.schedule.opens}</span>
          )}
          <Button icon={<ReloadOutlined />} onClick={() => { setLoading(true); load(); }}>Refresh</Button>
        </div>
      </div>

      <div className="fbx-sched" aria-label="Weekly schedule">
        {sched.map(([Ic, label, val], i) => (
          <div key={label} className="fbx-sched-i">
            <span className="fbx-sched-n">{i + 1}</span>
            <span className="fbx-sched-ic"><Ic /></span>
            <div><small>{label}</small><b>{val}</b></div>
          </div>
        ))}
      </div>

      <div className="pol-stats">
        <div className="pol-stat"><span className="pol-stat-ic violet"><TeamOutlined /></span><div><b>{learners}</b><span>Active learners · {batches.length} batches</span></div></div>
        <div className="pol-stat"><span className={`pol-stat-ic ${focusPct === null ? 'blue' : focusPct >= 80 ? 'teal' : 'amber'}`}><CheckCircleOutlined /></span><div><b>{focusPct === null ? '—' : `${focusPct}%`}</b><span>{d.focusWeek ? `Responded · week of ${weekLabel(d.focusWeek)} (${focusSubmitted}/${learners})` : 'No week asked yet'}</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic amber"><ClockCircleOutlined /></span><div><b>{d.nonRespondents.length}</b><span>Not submitted{atRisk ? ` · ${atRisk} missed 3 weeks` : ''}</span></div></div>
        <div className="pol-stat"><span className={`pol-stat-ic ${d.lowScores.length || d.concerns.count ? 'fbx-red' : 'teal'}`}><WarningOutlined /></span><div><b>{d.lowScores.length + d.concerns.count}</b><span>{d.lowScores.length} low-score area{d.lowScores.length === 1 ? '' : 's'} · {d.concerns.count} serious</span></div></div>
      </div>

      <section className="pol-box" aria-label="Response rate by batch">
        <div className="fbx-hd">
          <div>
            <b>Response rate by batch</b>
            <span className="pol-note">Each cell = learners who submitted that week ÷ active learners in the batch. Click a batch to see who hasn&apos;t submitted.</span>
          </div>
          <div className="fbx-legend">
            <span><i className="ok" /> 80%+ good</span>
            <span><i className="mid" /> 60–79%</span>
            <span><i className="bad" /> below 60%</span>
            <span><i className="none" /> — form not sent yet</span>
          </div>
        </div>
        {d.responseRate.length === 0 ? (
          <div className="fbx-empty">No active batches.</div>
        ) : (
          <div className="fbx-table-wrap">
            <table className="fbx-table">
              <thead>
                <tr>
                  <th className="fbx-sticky">Batch</th>
                  <th>Learners</th>
                  {d.weeks.map((k) => (
                    <th key={k} className={k === d.focusWeek ? 'cur' : ''}>
                      {weekLabel(k)}
                      {k === d.focusWeek && <small>{d.window ? 'open' : 'latest'}</small>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.responseRate.map((b) => (
                  <tr key={b.batch} className={b.batch === batch ? 'sel' : ''} onClick={() => setBatch(b.batch)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setBatch(b.batch); }}>
                    <td className="fbx-sticky"><b>{b.batch}</b></td>
                    <td><span className="fbx-n">{b.eligible}</span></td>
                    {b.weeks.map((w) => (
                      <td key={w.weekKey} className={w.weekKey === d.focusWeek ? 'cur' : ''}>
                        {w.pct === null ? (
                          <span className="fbx-cell none">—</span>
                        ) : (
                          <Tooltip title={`${w.submitted} of ${b.eligible} learners submitted${w.open ? ' · week still open' : ''}`}>
                            <span className={`fbx-cell ${tone(w.pct)}`}>
                              <b>{w.pct}%</b>
                              <small>{w.submitted}/{b.eligible}{w.open ? ' · open' : ''}</small>
                            </span>
                          </Tooltip>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="fbx-grid">
        <section className="pol-box" aria-label="Non-respondents">
          <div className="fbx-hd">
            <div>
              <b>Not submitted{d.focusWeek ? ` · week of ${weekLabel(d.focusWeek)}` : ''}</b>
              <span className="pol-note">Pick a batch, then remind everyone in it who hasn&apos;t filled the form (in-app + email).</span>
            </div>
            <Tooltip title={!d.window ? 'Reminders can only go out while a feedback week is open (Fri 6 PM – Tue 11:59 PM).' : !nonResp.length ? 'Everyone in this batch has submitted.' : ''}>
              <Button type="primary" icon={<SendOutlined />} disabled={!d.window || !nonResp.length} loading={sending} onClick={remind}>
                Remind {nonResp.length || ''} in {batch || 'batch'}
              </Button>
            </Tooltip>
          </div>
          <div className="pol-pills">
            {batches.map((b) => (
              <button key={b} type="button" className={`pol-pill${b === batch ? ' on' : ''}`} onClick={() => setBatch(b)}>
                {b} <span className="fbx-pill-n">{missBy[b] || 0}</span>
              </button>
            ))}
          </div>
          {!d.window && <div className="pol-alert info"><ClockCircleOutlined /><span>No feedback week is open right now — reminders can be sent from <b>{d.schedule.opens}</b> till <b>{d.schedule.lateUntil}</b>.</span></div>}
          {!d.focusWeek ? (
            <div className="fbx-empty">No feedback week has opened yet.</div>
          ) : nonResp.length === 0 ? (
            <div className="pol-alert ok"><CheckCircleOutlined /><span>Everyone in <b>{batch}</b> has submitted.</span></div>
          ) : (
            <div className="fbx-people">
              {nonResp.slice(0, 50).map((n) => (
                <div className="fbx-person" key={`${n.name}-${n.batch}`}>
                  <span className={`fbx-av ${n.weeksMissing >= 3 ? 'bad' : n.weeksMissing === 2 ? 'mid' : ''}`}>{initials(n.name)}</span>
                  <span className="fbx-person-n">
                    <b>{n.name}</b>
                    <small>{n.weeksMissing >= 3 ? 'Missed all of the last 3 weeks — follow up' : `Missed ${n.weeksMissing} of the last 3 weeks`}</small>
                  </span>
                  <span className="fbx-person-c">
                    <Tooltip title="Reminders sent this week"><span className={`pol-chip ${n.reminders >= d.schedule.maxReminders ? 'amber' : ''}`}><BellOutlined /> {n.reminders}/{d.schedule.maxReminders}</span></Tooltip>
                    <span className="fbx-dots" title={`${n.weeksMissing} of last 3 weeks missing`}>
                      {[0, 1, 2].map((i) => <i key={i} className={i < n.weeksMissing ? 'x' : ''} />)}
                    </span>
                    {n.lastEmail && (
                      <Tooltip title="Last reminder email"><span className={`pol-chip ${n.lastEmail === 'sent' ? 'green' : 'red'}`}>{n.lastEmail === 'sent' ? <MailOutlined /> : <StopOutlined />} {n.lastEmail === 'sent' ? 'delivered' : n.lastEmail}</span></Tooltip>
                    )}
                  </span>
                </div>
              ))}
              {nonResp.length > 50 && <div className="pol-note">+ {nonResp.length - 50} more</div>}
            </div>
          )}
        </section>

        <div className="fbx-col">
          <section className="pol-box" aria-label="Low scores">
            <div className="fbx-hd">
              <div>
                <b>Low-scoring areas</b>
                <span className="pol-note">Questions averaging below 3 / 5{d.focusWeek ? ` in the week of ${weekLabel(d.focusWeek)}` : ''} (only batches with enough responses).</span>
              </div>
            </div>
            {d.lowScores.length === 0 ? (
              <div className="pol-alert ok"><CheckCircleOutlined /><span>No low-scoring areas this week (or not enough responses yet).</span></div>
            ) : (
              <div className="fbx-low">
                {d.lowScores.map((l) => (
                  <div className="fbx-low-i" key={`${l.batch}-${l.kind}-${l.question}`}>
                    <div className="fbx-low-t">
                      <b>{l.question}</b>
                      <small>{l.batch} · {l.kind === 'pm' ? 'Project Manager form' : 'Weekly form'} · {l.responses} responses</small>
                    </div>
                    <div className="fbx-low-s">
                      <b>{l.avg}</b><small>/ 5</small>
                      <div className="fbx-low-bar"><div style={{ width: `${(l.avg / 5) * 100}%` }} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="pol-box" aria-label="Serious concerns">
            <div className="fbx-hd">
              <div>
                <b><SafetyCertificateOutlined /> Serious / conduct concerns</b>
                <span className="pol-note">Raised privately by learners in the form · last 8 weeks.</span>
              </div>
              {d.concerns.restricted ? <span className="pol-chip amber">MGMT ONLY</span> : <span className={`pol-chip ${d.concerns.count ? 'red' : 'green'}`}>{d.concerns.count}</span>}
            </div>
            {d.concerns.restricted ? (
              <div className="pol-alert admin"><SafetyCertificateOutlined /><span><b>{d.concerns.count}</b> reported — details are visible to management only.</span></div>
            ) : d.concerns.items.length === 0 ? (
              <div className="pol-alert ok"><CheckCircleOutlined /><span>None reported in the last 8 weeks.</span></div>
            ) : (
              <div className="fbx-low">
                {d.concerns.items.map((c, i) => (
                  <div className="fbx-concern" key={i}>
                    <div className="fbx-concern-t">{c.text || '(no details given)'}</div>
                    <small>{c.batch} · week of {weekLabel(c.weekKey)}</small>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
