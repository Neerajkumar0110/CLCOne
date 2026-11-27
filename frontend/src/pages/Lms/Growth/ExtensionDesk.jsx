import React, { useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, IB, Chip, Btn, Av, Card, Row, Col, KPI, Table, Lbl, Screen, Loading, ErrorBox, useData } from './ui';
import { fmtDT } from './projectsShared';

// Figma 2F "Extension & notification desk" (Support). Support never decides
// an extension — it nudges the mentor, tells the learner the decision, and
// asks mentors to re-allocate disqualified learners. Since 2026-11-26 (LMS
// testing report #35) Support can approve / reject a pending request too.

const KIND = {
  allocated: ['mail', 'Allocated'],
  'reminder-h48': ['bell', 'Reminder 48 h'],
  'reminder-h24': ['bell', 'Reminder 24 h'],
  'reminder-h1': ['bell', 'Reminder 1 h'],
  'reminder-custom': ['bell', 'Reminder'],
  'reminder-manual': ['bell', 'Manual reminder'],
  disqualified: ['x', 'Disqualified notice'],
  result: ['checkc', 'Result'],
  'extension-approved': ['clock', 'Extension approved'],
  'extension-rejected': ['clock', 'Extension rejected'],
  'extension-notice': ['clock', 'Extension decision'],
  reallocated: ['undo', 'Re-allocated'],
  resubmit: ['refresh', 'Resubmission allowed'],
  override: ['edit', 'Status changed'],
};

export default function ExtensionDesk() {
  const { data, error, loading, reload } = useData(() => api.projectDesk(), []);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const k = data.kpis;
  const run = async (fn) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
    } else message.error(r.message);
  };
  const latestAlloc = data.log.find((g) => g.kind === 'allocated');

  return (
    <Screen crumb="LMS / Extension Desk" title="Projects · Extension & Notification Desk">
      <Row className="g-rs">
        <KPI i="clock" label="Extension requests" val={k.extensions} sub={`${k.waitingMentor} waiting for mentor`} tone="pk" style={{ flex: 1 }} />
        <KPI i="mail" label="Notices sent today" val={k.sentToday} sub={`email ${k.emailToday} · in-app ${k.inAppToday}`} tone="pri" style={{ flex: 1 }} />
        <KPI i="alert" label="Delivery failures" val={k.failures} sub="failed emails (24 h)" tone="er" style={{ flex: 1 }} />
        <KPI i="undo" label="Re-allocation requests" val={k.reallocRequests} sub="sent to mentors" tone="ind" style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card title="Extension requests" i="clock" style={{ flex: 1 }}>
          <Table
            cols={[
              ['Learner', 'f'],
              ['Project', 160],
              ['Asked', 60],
              ['Reason', 180],
              ['Mentor decision', 140],
              ['', 210],
            ]}
            rows={data.extensions.map((a) => {
              const e = a.extension;
              const chip =
                e.status === 'pending' ? (
                  <Chip tone="wa" dot>
                    Pending mentor
                  </Chip>
                ) : e.status === 'approved' ? (
                  <Chip tone="ok" dot>
                    Approved +{e.grantedDays} d
                  </Chip>
                ) : (
                  <Chip tone="er" dot>
                    Rejected
                  </Chip>
                );
              const btn =
                e.status === 'pending' ? (
                  <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                    <Btn k="p" sm i="check" disabled={busy} onClick={() => run(() => api.decideExtension(a.id, { decision: 'approve', days: e.days }))}>
                      Approve
                    </Btn>
                    <Btn k="g" sm i="x" disabled={busy} onClick={() => run(() => api.decideExtension(a.id, { decision: 'reject' }))}>
                      Reject
                    </Btn>
                    <Btn k="g" sm i="bell" disabled={busy} onClick={() => run(() => api.nudge(a.id))} title={(e.nudges || []).length ? `Nudged ${e.nudges.length}×` : 'Remind the mentor'}>
                      Nudge
                    </Btn>
                  </span>
                ) : (
                  <Btn k="g" sm i={e.status === 'approved' ? 'send' : 'msg'} disabled={busy} onClick={() => run(() => api.notifyDecision(a.id))} title={e.notifiedAt ? `Sent ${fmtDT(e.notifiedAt)}` : ''}>
                    {e.status === 'approved' ? 'Notify' : 'Reply'}
                  </Btn>
                );
              return [
                <>
                  <Av name={a.learnerName} col={C.pu} s={24} />
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{a.learnerName}</span>
                </>,
                a.title,
                `+${e.days} d`,
                <span title={e.reason} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170, display: 'inline-block' }}>
                  {e.reason}
                </span>,
                chip,
                btn,
              ];
            })}
            empty="No extension requests in the last 30 days."
          />
          <Lbl>Disqualified · request re-allocation</Lbl>
          {data.disqualified.length === 0 && <span className="g-s12 g-fa">Nobody is disqualified.</span>}
          {data.disqualified.map((a) => (
            <Row key={a.id} g={10} className="g-ac" style={{ background: C.erL, borderRadius: 10, padding: 10 }}>
              <Av name={a.learnerName} col={C.er} s={26} />
              <b style={{ fontSize: 12.5, color: C.erD, flex: 1 }}>
                {a.groupName || a.learnerName} · {a.title}
              </b>
              <span style={{ fontSize: 11.5, color: C.erD }}>
                {a.reallocation.status === 'requested' ? `Requested ${fmtDT(a.reallocation.requestedAt)} · waiting for mentor` : a.reallocation.status === 'done' ? 'Re-allocated' : 'Not requested yet'}
              </span>
              <Btn k="s" sm i="undo" disabled={busy || a.reallocation.status === 'requested'} onClick={() => run(() => api.reallocRequest(a.id, ''))}>
                Request re-allocation
              </Btn>
            </Row>
          ))}
        </Card>

        <Col style={{ width: 400, flexShrink: 0 }}>
          <Card title="Notification log" i="mail" sub="Allocation, reminders, results · last 7 days">
            {data.log.length === 0 && <span className="g-s12 g-fa">No project notices yet.</span>}
            {data.log.map((g, i) => {
              const [ic, label] = KIND[g.kind] || ['bell', g.kind];
              const tone = g.failed.length ? 'er' : g.email + g.inApp === 0 ? 'wa' : 'ok';
              return (
                <Row key={i} g={10} className="g-ac" style={{ padding: '6px 0', borderBottom: `1px solid ${C.bg2}` }}>
                  <IB n={ic} box={28} s={14} bg={TONE[tone][0]} c={TONE[tone][1]} />
                  <Col g={0} style={{ flex: 1 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                      {label} · {g.title}
                      {g.whoN > 1 ? ` → ${g.whoN} learners` : g.who[0] ? ` · ${g.who[0]}` : ''}
                    </span>
                    <span className="g-s115 g-mut" title={g.failed.join('\n')}>
                      {g.email ? `Email ${g.emailOk} / ${g.email} delivered` : ''}
                      {g.email && g.inApp ? ' · ' : ''}
                      {g.inApp ? `In-app ${g.inApp}` : ''}
                      {g.failed.length ? ` · ${g.failed.length} failed` : ''} · {fmtDT(g.at)}
                    </span>
                  </Col>
                </Row>
              );
            })}
          </Card>
          <Card title="Email preview · allocation" i="eye">
            <Col g={8} style={{ border: `1px solid ${C.ln}`, borderRadius: 10, padding: 14 }}>
              <b style={{ fontSize: 13.5 }}>New project allocated: {latestAlloc ? latestAlloc.title : '<project title>'}</b>
              <span style={{ fontSize: 12, color: C.sub, lineHeight: '18px' }}>
                Hi {latestAlloc && latestAlloc.who[0] ? latestAlloc.who[0].split(' ')[0] : '<learner>'}, your mentor allocated a project. Your timer has started — deadline &lt;date, time&gt; IST. Reminders at 48 h, 24 h and 1 h.
              </span>
              <span>
                <Btn k="p" sm i="chevr">
                  Open project
                </Btn>
              </span>
            </Col>
            <Row g={10} className="g-ac" style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
              <IB n="bell" box={28} s={14} />
              <span style={{ fontSize: 12 }}>In-app: “{latestAlloc ? latestAlloc.title : 'Project'} allocated · N days left”</span>
            </Row>
          </Card>
        </Col>
      </Row>
    </Screen>
  );
}
