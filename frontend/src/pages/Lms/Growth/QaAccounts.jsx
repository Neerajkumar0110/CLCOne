import React, { useState } from 'react';
import { message } from 'antd';
import api from './api';
import { C, TONE, I, Chip, Btn, Card, Row, Col, Table, Check, KV, Note, Modal, Field, Screen, Loading, ErrorBox, useData } from './ui';

// Figma 4B "Test accounts & seed data" (QA / dev team).

const ROLE = { Student: ['Learner', 'pri'], Teacher: ['Mentor / Teacher', 'ind'], Support: ['Support', 'pu'], Admin: ['Admin', 'er'], owner: ['Admin', 'er'], 'Super Admin': ['Admin', 'er'] };
const SETS = [
  ['standard', 'Standard batch', 'QA learners · 12 weeks of activity · content progress'],
  ['edge', 'Edge cases', 'last QA learner inactive 6 days (alerts / outreach)'],
];

export default function QaAccounts() {
  const { data: d, error, loading, reload } = useData(() => api.qaAccounts(), []);
  const [sets, setSets] = useState(['standard', 'edge']);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState(null);
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox text={error} />;
  const copy = async (t) => {
    try {
      await navigator.clipboard.writeText(t);
      message.success('Copied');
    } catch (_) {
      message.info(t);
    }
  };
  const reset = async () => {
    if (!window.confirm('Wipe and re-seed the growth data (activity, projects, alerts, remarks, links) of every qa.* learner? Real learners are never touched.')) return;
    setBusy(true);
    const r = await api.qaReset(sets);
    setBusy(false);
    if (r.success) {
      message.success(r.message);
      reload();
    } else message.error(r.message);
  };
  const ISO = [
    ['db', 'Separate database', d.dbSeparate ? 'QA_DATABASE is its own database — no link to production' : 'Not yet — the test site uses the production database. Set QA_DATABASE on the QA server.', d.dbSeparate],
    ['user', 'Names & emails masked', 'Test logins are qa.* accounts only', true],
    ['phone', 'Reset touches QA data only', 'Only qa.* learners are wiped / re-seeded', true],
    ['lock', 'Payments disabled', d.payTest ? 'Razorpay test keys on this server' : 'This server uses live Razorpay keys — never pay from a QA account', d.payTest],
  ];

  return (
    <Screen qa crumb="LMS / Test Accounts" title="Test accounts & seed data">
      <Row className="g-rm" style={{ alignItems: 'flex-start' }}>
        <Card
          title="Role test accounts"
          i="users"
          style={{ flex: 1 }}
          right={
            <Btn k="g" sm i="plus" onClick={() => setAdd({ role: 'Student', name: '', email: '', password: '' })}>
              Add account
            </Btn>
          }
        >
          <Table
            cols={[
              ['Role', 150],
              ['Login', 'f'],
              ['Linked data', 230],
              ['', 100],
            ]}
            rows={[
              ...d.rows.map((r) => {
                const [l, t] = ROLE[r.role] || [r.role, 'mut'];
                return [
                  <Chip tone={t} s={11.5}>
                    {l}
                  </Chip>,
                  <span style={{ fontSize: 12.5 }}>{r.email}</span>,
                  r.linked,
                  <Btn k="s" sm i="user" onClick={() => copy(r.email)} title="Copy the login email — open a private window and sign in with the vault password">
                    Login as
                  </Btn>,
                ];
              }),
              [
                <Chip tone="sky" s={11.5}>
                  Recruiter
                </Chip>,
                <span style={{ fontSize: 12.5 }}>share link · no login</span>,
                d.recruiter ? 'Public profile of a QA learner' : 'No QA share link yet',
                d.recruiter ? (
                  <Btn k="s" sm i="link" href={`/p/${d.recruiter.token}`} target="_blank">
                    Open
                  </Btn>
                ) : (
                  <span className="g-fa">—</span>
                ),
              ],
            ]}
          />
          <Note tone="mut" i="lock">
            Passwords live in the team vault; all accounts share the password policy of production.
          </Note>
        </Card>

        <Col style={{ width: 420, flexShrink: 0 }}>
          <Card title="Seed datasets" i="db">
            {SETS.map(([k, l, sub]) => (
              <Row key={k} g={10} className="g-ac" style={{ background: C.bg, borderRadius: 10, padding: 10 }}>
                <Check on={sets.includes(k)} onChange={(v) => setSets(v ? [...sets, k] : sets.filter((x) => x !== k))} label="" />
                <Col g={0}>
                  <b style={{ fontSize: 12.5 }}>{l}</b>
                  <span className="g-s115 g-mut">{sub}</span>
                </Col>
              </Row>
            ))}
          </Card>
          <Card title="One-click data reset" i="refresh" style={{ borderColor: C.er }}>
            <span style={{ fontSize: 12.5, color: C.sub, lineHeight: '18px' }}>Wipes the qa.* learners' growth data and re-loads the selected seed sets. Real learners are never touched.</span>
            <KV k="Last reset" v={d.lastReset ? `${new Date(d.lastReset.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${(/ by ([^·]+)/.exec(d.lastReset.text) || [])[1] ? ` by ${(/ by ([^·]+)/.exec(d.lastReset.text) || [])[1].trim()}` : ''}` : 'never'} />
            <Btn k="dd" i="refresh" onClick={reset} disabled={busy || !sets.length} style={{ width: '100%' }}>
              {busy ? 'Resetting…' : 'Reset QA data now'}
            </Btn>
          </Card>
        </Col>
      </Row>

      <Card title="Data isolation & masking" i="shield">
        <Row g={12} className="g-rs">
          {ISO.map(([ic, t, sub, good]) => {
            const tt = good ? TONE.ok : TONE.er;
            return (
              <Col key={t} g={6} style={{ flex: 1, background: tt[0], borderRadius: 10, padding: 12 }}>
                <Row g={8} className="g-ac">
                  <I n={ic} c={tt[1]} s={16} />
                  <b style={{ fontSize: 13, color: tt[1] }}>{t}</b>
                </Row>
                <span style={{ fontSize: 12, color: tt[1] }}>{sub}</span>
              </Col>
            );
          })}
        </Row>
      </Card>

      <Modal open={!!add} onClose={() => setAdd(null)} label="Add test account">
        {add && (
          <>
            <b style={{ fontSize: 16 }}>Add test account</b>
            <Field label="Role" htmlFor="qa-role">
              <select id="qa-role" className="g-input" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value })}>
                <option value="Student">Learner</option>
                <option value="Teacher">Mentor / Teacher</option>
                <option value="Support">Support</option>
                <option value="Admin">Admin</option>
              </select>
            </Field>
            <Field label="Name" htmlFor="qa-name">
              <input id="qa-name" className="g-input" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="QA Learner Edge" />
            </Field>
            <Field label="Email (starts with qa.)" htmlFor="qa-email">
              <input id="qa-email" className="g-input" value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} placeholder="qa.learner.edge@careerlabconsulting.com" />
            </Field>
            <Field label="Password (save it in the vault)" htmlFor="qa-pw">
              <input id="qa-pw" type="password" className="g-input" value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} />
            </Field>
            <Row g={8} style={{ justifyContent: 'flex-end' }}>
              <Btn k="g" onClick={() => setAdd(null)}>
                Cancel
              </Btn>
              <Btn
                k="p"
                i="check"
                disabled={busy || add.password.length < 8}
                onClick={async () => {
                  setBusy(true);
                  const r = await api.qaAddAccount(add);
                  setBusy(false);
                  if (r.success) {
                    message.success(r.message);
                    setAdd(null);
                    reload();
                  } else message.error(r.message);
                }}
              >
                Create account
              </Btn>
            </Row>
          </>
        )}
      </Modal>
    </Screen>
  );
}
