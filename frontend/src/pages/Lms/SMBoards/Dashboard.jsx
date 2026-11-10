import React, { useState } from 'react';
import { Alert } from 'antd';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import { SMPage, useLoad, Loading, res } from './shared';

// S1 — Support Manager "today": 6 KPIs and 9 exception cards across
// attendance, readiness & consent, assessments, weekly feedback, projects,
// recordings, system, payment → provisioning and tickets. One aggregate
// endpoint (/admin/sm/dashboard), every number is a live count.

const Li = ({ label, value, tone, last }) => (
  <div className="ld-li" style={last ? { borderBottom: 0 } : undefined}>
    <span>{label}</span>
    <b style={tone ? { color: tone } : undefined}>{value}</b>
  </div>
);
const RED = '#991b1b';
const AMB = '#9a3412';
const GRN = '#166534';

export default function SMDashboard() {
  const navigate = useNavigate();
  const [batch, setBatch] = useState('');
  const { data, loading, error } = useLoad(async () => res(await lmsApi.smDashboard(batch ? { batch } : {})), [batch]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const d = data;
  const k = d.kpis;
  const go = (p) => () => navigate(p);
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <SMPage
      title="Support Manager — today"
      sub={`Role: Support Manager (dedicated, not Super Admin) · ${batch || 'all batches'} · ${today}`}
      right={
        <select className="ld-inp" aria-label="Batch" value={batch} onChange={(e) => setBatch(e.target.value)}>
          <option value="">All batches ({d.batches.length})</option>
          {d.batches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      }
    >
      <div className="sm-g6" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12 }}>
        <div className="sm-kpi"><span className="lab">Active learners</span><span className="num">{k.activeLearners}</span></div>
        <div className="sm-kpi"><span className="lab">Classes today</span><span className="num">{k.classesToday}</span><span className="sub">{k.liveNow} live now</span></div>
        <div className="sm-kpi"><span className="lab">Absent yesterday</span><span className="num" style={{ color: k.absentYesterday ? AMB : undefined }}>{k.absentYesterday}</span></div>
        <div className="sm-kpi"><span className="lab">Open tickets</span><span className="num">{k.openTickets}</span>{k.slaRisk > 0 && <span className="sub" style={{ color: RED, fontWeight: 600 }}>{k.slaRisk} SLA at risk</span>}</div>
        <div className="sm-kpi"><span className="lab">Failed jobs (24h)</span><span className="num" style={{ color: k.failedJobs ? RED : undefined }}>{k.failedJobs}</span></div>
        <div className="sm-kpi"><span className="lab">Pending consent</span><span className="num">{k.pendingConsent}</span></div>
      </div>

      <div className="sm-g3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, flex: 1, minHeight: 0 }}>
        <section className="ld-card" aria-label="Attendance exceptions">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Attendance exceptions</b><button type="button" className="ld-link" style={{ fontSize: 12 }} onClick={go('/support-mgr/attendance')}>Open →</button></div>
          <Li label="Level 3 · 10+ din absent" value={d.attendance.l3} tone={d.attendance.l3 ? RED : undefined} />
          <Li label="Level 2 · irregular" value={d.attendance.l2} />
          <Li label="Level 1 · missed last class" value={d.attendance.l1} />
          <Li label="Dropped status to reconcile" value={d.attendance.droppedToReconcile} last />
        </section>
        <section className="ld-card" aria-label="Readiness and consent">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Readiness &amp; consent</b></div>
          <Li label={d.readiness.policyLabel ? `${d.readiness.policyLabel} pending` : 'Policy consent pending'} value={d.readiness.policiesPending} />
          <Li label="Readiness not passed" value={d.readiness.readinessNotPassed} />
          <Li label="Readiness not taken yet" value={d.readiness.readinessNotTaken} />
          <Li label="Technical review (suspended attempts)" value={d.readiness.technical} last />
        </section>
        <section className="ld-card" aria-label="Assessment queue">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Assessment queue</b></div>
          <Li label="Test types running" value={d.assessments.testTypes} />
          <Li label="Not attempted any test" value={d.assessments.notAttempted} />
          <Li label="Last attempt left" value={d.assessments.lastAttemptLeft} tone={d.assessments.lastAttemptLeft ? AMB : undefined} />
          <Li label="Result reports verified by PMs" value={d.assessments.verified} last />
        </section>
        <section className="ld-card" aria-label="Weekly feedback">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Weekly feedback{d.feedback.week ? ` · week of ${new Date(`${d.feedback.week}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}</b><button type="button" className="ld-link" style={{ fontSize: 12 }} onClick={go('/support-mgr/feedback')}>Open →</button></div>
          {d.feedback.rates.length === 0 && <div className="ld-empty">No batch has feedback yet.</div>}
          {d.feedback.rates.map((r) => <Li key={r.batch} label={`${r.batch}${r.time ? ` ${r.time}` : ''}`} value={`${r.pct}%`} />)}
          <Li label="Delivery failures (24h)" value={d.feedback.deliveryFailures} tone={d.feedback.deliveryFailures ? RED : undefined} last />
        </section>
        <section className="ld-card" aria-label="Projects">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Projects</b></div>
          <Li label="Overdue milestones" value={d.projects.overdue} />
          <Li label="Reviews pending > 3 din" value={d.projects.reviewsPending} />
          <Li label="Blocked learners" value={d.projects.blocked} last />
        </section>
        <section className="ld-card" aria-label="Recording health">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Recording health</b><button type="button" className="ld-link" style={{ fontSize: 12 }} onClick={go('/support-mgr/recordings')}>Open →</button></div>
          <Li label="Failed / retry queue" value={d.recordings.failed} tone={d.recordings.failed ? RED : undefined} />
          <Li label="Processing" value={d.recordings.processing} />
          <Li label="Deleted at source" value={d.recordings.deleted} />
          <Li label="Available" value={d.recordings.available} last />
        </section>
        <section className="ld-card" aria-label="System and automation">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>System &amp; automation</b></div>
          <Li label={`Meeting provider (${d.system.provider === 'bigbluebutton' ? 'BBB' : d.system.provider})`} value={d.system.provider === 'mock' ? 'Not live' : 'Healthy'} tone={d.system.provider === 'mock' ? AMB : GRN} />
          <Li label="Webhook failures" value={d.system.webhookFails} />
          <Li label="Email failures (24h)" value={d.system.mailFails} last />
        </section>
        <section className="ld-card" aria-label="Payment to provisioning">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Payment → provisioning</b></div>
          <Li label="Paid, no LMS login yet" value={d.payments.paidNotProvisioned} tone={d.payments.paidNotProvisioned ? RED : undefined} last />
        </section>
        <section className="ld-card" aria-label="Tickets">
          <div className="ld-hd"><b style={{ fontSize: 14 }}>Tickets</b><button type="button" className="ld-link" style={{ fontSize: 12 }} onClick={go('/support-mgr/tickets')}>Queue →</button></div>
          <Li label="Unassigned" value={d.tickets.unassigned} />
          <Li label="Waiting for learner / tech" value={d.tickets.waiting} last />
        </section>
      </div>
    </SMPage>
  );
}
