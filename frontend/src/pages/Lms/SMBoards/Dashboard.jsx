import React, { useState } from 'react';
import { Alert, Modal, Button, Select } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  TeamOutlined, VideoCameraOutlined, UserDeleteOutlined, CustomerServiceOutlined, WarningOutlined, FileProtectOutlined,
  CheckSquareOutlined, TrophyOutlined, ExperimentOutlined, MessageOutlined, ProjectOutlined, PlayCircleOutlined, CloudServerOutlined,
  CreditCardOutlined, ArrowRightOutlined, DashboardOutlined, ExpandAltOutlined,
} from '@ant-design/icons';
import lmsApi from '../api';
import { useLoad, Loading, res } from './shared';
import '../AdminOps/mgmt.css';
import '../AdminOps/opsPages.css';
import './smDesign.css';

// S1 — Support Manager "today": 6 KPIs and 9 exception cards across
// attendance, readiness & consent, assessments, weekly feedback, projects,
// recordings, system, payment → provisioning and tickets. One aggregate
// endpoint (/admin/sm/dashboard), every number is a live count.
// 2026-11-27 redesign: gradient hero, icon KPI tiles, equal-height exception
// cards with toned rows; any card opens in a modal with a link to its page.

export default function SMDashboard() {
  const navigate = useNavigate();
  const [batch, setBatch] = useState('');
  const [open, setOpen] = useState(null);
  const { data, loading, error } = useLoad(async () => res(await lmsApi.smDashboard(batch ? { batch } : {})), [batch]);
  if (loading && !data) return <Loading />;
  if (error) return <Alert type="error" showIcon message={error} style={{ margin: 24 }} />;
  const d = data;
  const k = d.kpis;
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  const wk = d.feedback.week ? new Date(`${d.feedback.week}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';

  // tone: 'bad' red, 'mid' amber, 'ok' green, undefined neutral
  const cards = [
    {
      key: 'att', title: 'Attendance exceptions', icon: CheckSquareOutlined, g: 'g3', to: '/support-mgr/attendance',
      desc: 'Learners whose attendance needs a follow-up, by escalation level.',
      rows: [
        ['Level 3 · absent 10+ days', d.attendance.l3, d.attendance.l3 ? 'bad' : 'ok'],
        ['Level 2 · irregular', d.attendance.l2, d.attendance.l2 ? 'mid' : 'ok'],
        ['Level 1 · missed last class', d.attendance.l1],
        ['Dropped status to reconcile', d.attendance.droppedToReconcile],
      ],
    },
    {
      key: 'rd', title: 'Readiness & consent', icon: FileProtectOutlined, g: 'g1',
      desc: 'Policy consent still pending and the readiness test pipeline.',
      rows: [
        [d.readiness.policyLabel ? `${d.readiness.policyLabel} pending` : 'Policy consent pending', d.readiness.policiesPending, d.readiness.policiesPending ? 'mid' : 'ok'],
        ['Readiness not passed', d.readiness.readinessNotPassed],
        ['Readiness not taken yet', d.readiness.readinessNotTaken],
        ['Technical review (suspended attempts)', d.readiness.technical, d.readiness.technical ? 'mid' : undefined],
      ],
    },
    {
      key: 'as', title: 'Assessment queue', icon: TrophyOutlined, g: 'g4',
      desc: 'Who still has to attempt a test and who is on their last attempt.',
      rows: [
        ['Test types running', d.assessments.testTypes],
        ['Not attempted any test', d.assessments.notAttempted],
        ['Last attempt left', d.assessments.lastAttemptLeft, d.assessments.lastAttemptLeft ? 'mid' : undefined],
        ['Result reports verified by PMs', d.assessments.verified],
      ],
    },
    {
      key: 'fb', title: `Weekly feedback${wk ? ` · week of ${wk}` : ''}`, icon: MessageOutlined, g: 'g5', to: '/support-mgr/feedback',
      desc: 'Response rate per batch for the latest feedback week.',
      rows: [
        ...d.feedback.rates.map((r) => [`${r.batch}${r.time ? ` ${r.time}` : ''}`, `${r.pct}%`, r.pct >= 80 ? 'ok' : r.pct >= 60 ? 'mid' : 'bad']),
        ['Delivery failures (24h)', d.feedback.deliveryFailures, d.feedback.deliveryFailures ? 'bad' : undefined],
      ],
    },
    {
      key: 'pj', title: 'Projects', icon: ProjectOutlined, g: 'g2',
      desc: 'Milestones and reviews running late.',
      rows: [
        ['Overdue milestones', d.projects.overdue, d.projects.overdue ? 'mid' : 'ok'],
        ['Reviews pending over 3 days', d.projects.reviewsPending, d.projects.reviewsPending ? 'mid' : 'ok'],
        ['Blocked learners', d.projects.blocked, d.projects.blocked ? 'bad' : 'ok'],
      ],
    },
    {
      key: 'rc', title: 'Recording health', icon: PlayCircleOutlined, g: 'g6', to: '/support-mgr/recordings',
      desc: 'Class recordings by processing state.',
      rows: [
        ['Failed / retry queue', d.recordings.failed, d.recordings.failed ? 'bad' : 'ok'],
        ['Processing', d.recordings.processing],
        ['Deleted at source', d.recordings.deleted],
        ['Available', d.recordings.available, 'ok'],
      ],
    },
    {
      key: 'sy', title: 'System & automation', icon: CloudServerOutlined, g: 'g2',
      desc: 'Meeting provider, webhooks and email delivery.',
      rows: [
        [`Meeting provider (${d.system.provider === 'bigbluebutton' ? 'BBB' : d.system.provider})`, d.system.provider === 'mock' ? 'Not live' : 'Healthy', d.system.provider === 'mock' ? 'mid' : 'ok'],
        ['Webhook failures', d.system.webhookFails, d.system.webhookFails ? 'bad' : undefined],
        ['Email failures (24h)', d.system.mailFails, d.system.mailFails ? 'bad' : undefined],
      ],
    },
    {
      key: 'py', title: 'Payment → provisioning', icon: CreditCardOutlined, g: 'g3',
      desc: 'Paid learners who still have no LMS login.',
      rows: [['Paid, no LMS login yet', d.payments.paidNotProvisioned, d.payments.paidNotProvisioned ? 'bad' : 'ok']],
    },
    {
      key: 'tk', title: 'Tickets', icon: CustomerServiceOutlined, g: 'g5', to: '/support-mgr/tickets',
      desc: 'Support tickets that need someone to pick them up.',
      rows: [
        ['Unassigned', d.tickets.unassigned, d.tickets.unassigned ? 'mid' : 'ok'],
        ['Waiting for learner / tech', d.tickets.waiting],
      ],
    },
  ];
  const kpis = [
    [TeamOutlined, 'g1', k.activeLearners, 'Active learners', null, 'none'],
    [VideoCameraOutlined, 'g3', k.classesToday, 'Classes today', `${k.liveNow} live now`, k.liveNow ? 'ok' : 'none'],
    [UserDeleteOutlined, 'g4', k.absentYesterday, 'Absent yesterday', null, k.absentYesterday ? 'mid' : 'ok'],
    [CustomerServiceOutlined, 'g5', k.openTickets, 'Open tickets', k.slaRisk ? `${k.slaRisk} SLA at risk` : 'all within SLA', k.slaRisk ? 'bad' : 'ok'],
    [WarningOutlined, 'g6', k.failedJobs, 'Failed jobs (24h)', null, k.failedJobs ? 'bad' : 'ok'],
    [FileProtectOutlined, 'g2', k.pendingConsent, 'Pending consent', null, k.pendingConsent ? 'mid' : 'ok'],
  ];
  const cur = cards.find((c) => c.key === open);
  const flagged = (c) => c.rows.filter((r) => r[2] === 'bad' || r[2] === 'mid').length;

  return (
    <div className="mg op smx">
      <div className="mg-hero smx-hero">
        <div className="mg-hero-l">
          <span className="mg-hero-ic"><DashboardOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="mg-kicker">Support Manager · today</span>
            <h1>{today}</h1>
            <p>Dedicated Support Manager role (not Super Admin) · {batch || 'all batches'} · every number is a live count — click a card for details.</p>
          </div>
        </div>
        <div className="op-hero-search">
          <Select value={batch} onChange={setBatch} style={{ minWidth: 220 }} options={[{ value: '', label: `All batches (${d.batches.length})` }, ...d.batches.map((b) => ({ value: b, label: b }))]} />
        </div>
      </div>

      <div className="mg-kpis op-kpis">
        {kpis.map(([Ic, g, v, label, sub, tone]) => (
          <div className={`mg-k ${tone}`} key={label}>
            <div className="mg-k-top"><span className={`mg-k-ic ${g}`}><Ic /></span></div>
            <b className="mg-k-v">{v}</b>
            <span className="mg-k-l">{label}</span>
            {sub && <small className={`smx-sub ${tone}`}>{sub}</small>}
          </div>
        ))}
      </div>

      <div className="smx-grid">
        {cards.map((c) => {
          const Ic = c.icon;
          const nf = flagged(c);
          return (
            <section key={c.key} className="mg-card smx-card" role="button" tabIndex={0} onClick={() => setOpen(c.key)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(c.key); }}>
              <div className="mg-hd">
                <span className={`mg-hd-ic ${c.g}`}><Ic /></span>
                <div><b>{c.title}</b><small>{nf ? `${nf} need attention` : 'Nothing urgent'}</small></div>
                <ExpandAltOutlined className="smx-exp" />
              </div>
              <div className="mg-card-body smx-body">
                {c.rows.length === 0 && <div className="mg-empty">Nothing here yet.</div>}
                {c.rows.slice(0, 5).map(([label, value, tone]) => (
                  <div className={`smx-li ${tone || ''}`} key={label}><span>{label}</span><b>{value}</b></div>
                ))}
              </div>
              {c.to && (
                <div className="mg-foot smx-foot">
                  <button type="button" className="smx-go" onClick={(e) => { e.stopPropagation(); navigate(c.to); }}>Open page <ArrowRightOutlined /></button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Modal open={!!cur} onCancel={() => setOpen(null)} footer={null} width={560} centered destroyOnClose rootClassName="mg-modal">
        {cur && (() => {
          const Ic = cur.icon;
          return (
            <div className="mg-m">
              <div className="mg-m-head smx-m-head"><span className="mg-act">{batch || 'All batches'}</span><h3><Ic /> {cur.title}</h3><span>{cur.desc}</span></div>
              <div className="mg-m-body">
                {cur.rows.map(([label, value, tone]) => (
                  <div className={`smx-mrow ${tone || ''}`} key={label}>
                    <i />
                    <span>{label}</span>
                    <b>{value}</b>
                  </div>
                ))}
                <div className="mg-m-id">Live count · refreshed when the page loads or the batch changes</div>
              </div>
              <div className="mg-m-foot" style={{ gap: 8 }}>
                <Button onClick={() => setOpen(null)}>Close</Button>
                {cur.to && <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate(cur.to)}>Open {cur.title.split(' · ')[0].toLowerCase()}</Button>}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
