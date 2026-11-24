import React, { useEffect, useState } from 'react';
import { message } from 'antd';
import api from './api';
import Learner360Report from './Learner360Report';
import { C, TONE, IB, Chip, Btn, Av, Card, Row, Col, KPI, Table, Tabs, Field, Screen, Loading, ErrorBox, useData } from './ui';
import { toLocalInput } from './projectsShared';

// Figma 3D "Inactive learner outreach" (Support).

const OUTCOMES = ['Reached — will resume tomorrow', 'Reached — needs help', 'Reached — wants a pause', 'No answer', 'Wrong / switched-off number', 'Resolved — back to learning'];
const fmtD = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export default function InactiveOutreach() {
  const [tab, setTab] = useState('to_contact');
  const { data: d, error, loading, reload } = useData(() => api.outreach(tab), [tab]);
  const [sel, setSel] = useState(null);
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({ template: '', outcome: OUTCOMES[0], notes: '', followUpAt: '', escalateTo: '', channel: '' });
  const [busy, setBusy] = useState(false);
  const [show360, setShow360] = useState(null);

  useEffect(() => {
    if (d && d.rows.length) setSel((s) => (s && d.rows.find((r) => r.id === s.id)) || d.rows[0]);
    else setSel(null);
  }, [d]);
  useEffect(() => {
    if (!sel) return;
    setInfo(null);
    api.outreachLearner(sel.id).then((r) => r.success && setInfo(r.result));
    const first = String(sel.name || '').split(' ')[0];
    setF({
      template: `Hi ${first}, we noticed you haven't logged in${sel.lastActive ? ` since ${new Date(sel.lastActive).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ' recently'}. Your mentor${sel.mentor ? ` ${sel.mentor}` : ''} has a catch-up plan ready — can we help you restart today?`,
      outcome: OUTCOMES[0],
      notes: sel.notes || '',
      followUpAt: toLocalInput(sel.followUpAt || new Date(Date.now() + 2 * 86400000)),
      escalateTo: sel.escalateTo || '',
      channel: '',
    });
  }, [sel]);

  if (show360)
    return (
      <div>
        <div className="g-root" style={{ minHeight: 0 }}>
          <div style={{ padding: '12px 28px 0' }}>
            <Btn k="g" sm onClick={() => setShow360(null)}>
              Back to outreach queue
            </Btn>
          </div>
        </div>
        <Learner360Report learnerId={show360} crumbBase="LMS / Inactive Learners" />
      </div>
    );
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const k = d.kpis;
  const run = async (fn, after) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      if (after) after();
      reload();
    } else message.error(r.message);
  };
  const phone = info && info.phone ? String(info.phone).replace(/\D/g, '') : '';
  const wa = phone ? `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(f.template)}` : null;
  const daysTone = (n) => (n >= 7 ? 'er' : n >= 5 ? 'or' : 'wa');

  return (
    <Screen crumb="LMS / Inactive Learners" title="Inactive Learners · outreach queue">
      <Row className="g-rs">
        <KPI i="alert" label={`Inactive > ${d.days} days`} val={k.inQueue} sub={`${k.newToday} new today`} tone="er" style={{ flex: 1 }} />
        <KPI i="phone" label="Contacted today" val={k.contactedToday} sub={`${k.reached} reached`} tone="pu" style={{ flex: 1 }} />
        <KPI i="refresh" label="Re-activated (7 days)" val={k.reactivated} sub="back to daily practice" tone="ok" style={{ flex: 1 }} />
        <KPI i="flag" label="Drop-out risk" val={k.risk} sub="escalated to admin" tone="or" style={{ flex: 1 }} />
      </Row>

      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title="Queue"
          i="list"
          style={{ flex: 1 }}
          right={
            <Tabs
              items={[
                ['to_contact', 'To contact'],
                ['follow_up', 'Follow-up'],
                ['resolved', 'Resolved'],
              ]}
              act={tab}
              onChange={setTab}
            />
          }
        >
          <Table
            cols={[
              ['Learner', 'f'],
              ['Inactive', 76],
              ['Batch', 120],
              ['Mentor', 100],
              ['Attempts', 70],
              [tab === 'follow_up' ? 'Follow-up' : 'Last contact', 110],
              ['Channels', 96],
            ]}
            hl={d.rows.map((r, i) => (sel && r.id === sel.id ? i : -1)).filter((i) => i >= 0)}
            onRow={(i) => setSel(d.rows[i])}
            rows={d.rows.map((r) => [
              <>
                <Av name={r.name} col={C.pu} s={24} />
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                  {r.name}
                  {r.dropRisk ? ' ⚑' : ''}
                </span>
              </>,
              r.inactiveDays != null ? (
                <Chip tone={daysTone(r.inactiveDays)} s={10.5}>
                  {r.inactiveDays} d
                </Chip>
              ) : (
                '—'
              ),
              r.batch,
              r.mentor || '—',
              String(r.attempts),
              tab === 'follow_up' ? fmtD(r.followUpAt) : r.lastOutcome || '—',
              <span style={{ display: 'inline-flex', gap: 4 }}>
                {(r.channels.length ? r.channels : ['phone', 'wa', 'mail']).map((ch) => (
                  <IB key={ch} n={ch === 'call' ? 'phone' : ch === 'whatsapp' ? 'wa' : ch === 'email' ? 'mail' : ch} box={24} s={12} bg={C.bg2} c={r.channels.length ? C.pu : C.sub} r={6} />
                ))}
              </span>,
            ])}
            empty={tab === 'to_contact' ? 'Nobody to contact right now.' : tab === 'follow_up' ? 'No follow-ups scheduled.' : 'Nothing resolved yet.'}
          />
        </Card>

        {sel && (
          <Card
            title={sel.name}
            i="user"
            tone="pu"
            sub={[sel.learnerId, sel.inactiveDays != null ? `inactive ${sel.inactiveDays} days` : null, sel.lastActive ? `last active ${new Date(sel.lastActive).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null].filter(Boolean).join(' · ')}
            style={{ width: 420, flexShrink: 0 }}
            right={
              <Btn k="s" sm i="target" onClick={() => setShow360(sel.learner)}>
                360°
              </Btn>
            }
          >
            <Row g={8}>
              {[
                ['Engagement', info ? (info.engagement == null ? '—' : String(info.engagement)) : '…', info && info.engagement != null && info.engagement >= 40 ? 'ok' : 'er'],
                ['Readiness', info ? (info.readiness == null ? '—' : String(info.readiness)) : '…', info && info.readiness >= 60 ? 'ok' : 'er'],
                ['Projects', info ? info.projects : '…', info && info.projectsBad ? 'er' : 'mut'],
              ].map(([a, b, t]) => (
                <Col key={a} g={2} style={{ flex: 1, background: C.bg, borderRadius: 10, padding: '8px 10px' }}>
                  <span className="g-s11 g-mut">{a}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: TONE[t][1] }}>{b}</span>
                </Col>
              ))}
            </Row>
            <Row g={8}>
              <Btn k="p" i="phone" href={phone ? `tel:${phone}` : undefined} disabled={!phone} style={{ flex: 1 }} title={phone ? '' : 'No phone on file'}>
                <span onClick={() => setF((x) => ({ ...x, channel: 'call' }))}>Call</span>
              </Btn>
              <Btn k="ok" i="wa" href={wa || undefined} target="_blank" disabled={!wa} style={{ flex: 1 }}>
                <span onClick={() => setF((x) => ({ ...x, channel: 'whatsapp' }))}>WhatsApp</span>
              </Btn>
              <Btn
                k="s"
                i="mail"
                disabled={busy || !sel.email}
                style={{ flex: 1 }}
                onClick={() => {
                  setF((x) => ({ ...x, channel: 'email' }));
                  run(() => api.outreachEmail(sel.id, f.template));
                }}
              >
                Email
              </Btn>
            </Row>
            <Field label="Message template" htmlFor="o-tpl">
              <textarea id="o-tpl" className="g-input" rows={3} style={{ minHeight: 72 }} value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })} />
            </Field>
            <Field label="Outcome" htmlFor="o-out">
              <select id="o-out" className="g-input" value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Notes" htmlFor="o-notes">
              <textarea id="o-notes" className="g-input" rows={2} style={{ minHeight: 56 }} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What they said, what was agreed…" />
            </Field>
            <Row g={10}>
              <Field label="Follow-up" htmlFor="o-fu">
                <input id="o-fu" type="datetime-local" className="g-input" value={f.followUpAt} onChange={(e) => setF({ ...f, followUpAt: e.target.value })} />
              </Field>
              <Field label="Escalate to" htmlFor="o-esc">
                <select id="o-esc" className="g-input" value={f.escalateTo} onChange={(e) => setF({ ...f, escalateTo: e.target.value })}>
                  <option value="">Nobody</option>
                  <option value="Mentor">Mentor</option>
                  <option value="Admin">Admin</option>
                </select>
              </Field>
            </Row>
            {sel.contacts && sel.contacts.length > 0 && (
              <Col g={4}>
                {[...sel.contacts].reverse().slice(0, 4).map((c, i) => (
                  <span key={i} className="g-s115 g-mut">
                    {fmtD(c.at)} · {c.channel} · {c.outcome} · {c.by}
                  </span>
                ))}
              </Col>
            )}
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="d" i="flag" disabled={busy} onClick={() => run(() => api.dropRisk(sel.id))}>
                {sel.dropRisk ? 'Clear drop-out risk' : 'Mark drop-out risk'}
              </Btn>
              <Btn k="i" i="check" disabled={busy} onClick={() => run(() => api.saveOutreach(sel.id, { ...f, followUpAt: f.followUpAt ? new Date(f.followUpAt) : null, channel: f.channel || 'call' }))}>
                Save outcome
              </Btn>
            </Row>
          </Card>
        )}
      </Row>
    </Screen>
  );
}
