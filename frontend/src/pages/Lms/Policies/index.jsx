import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography, DatePicker, Progress, Drawer, Alert, Popconfirm,
} from 'antd';
import {
  FileProtectOutlined, PlusOutlined, CloudUploadOutlined, InboxOutlined, EyeOutlined, DeleteOutlined,
  TagOutlined, AppstoreOutlined, FileTextOutlined, LinkOutlined, CalendarOutlined, TeamOutlined, CheckSquareOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';
import '../StudentDashboard/StudentHome.css';
import '../components/LearnerDesign.css';
import './StudentConsent.css';

const { Text, Paragraph } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

/* ═══════════ TEACHER — read-only ═══════════ */
function ViewPolicies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lmsApi.listPolicies({ status: 'published' }).then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;
  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><FileProtectOutlined /> Policies</h2><p>Published policies (view only — managed by admin).</p></div></div>
      {rows.length === 0 ? <Card><Empty description="No published policies." /></Card> : rows.map((r) => (
        <Card key={r.id} size="small" style={{ marginBottom: 12 }} title={<Space><b>{r.title}</b><Tag>{r.category}</Tag><Text type="secondary">v{r.version}</Text></Space>}>
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 4 }}>{r.content}</Paragraph>
        </Card>
      ))}
    </div>
  );
}

/* ═══════════ STUDENT — consent page (design L1) ═══════════ */
// One page lists every policy that applies to the learner (Accepted / Read /
// Not opened), each readable in a modal, and a single acknowledgement accepts
// all pending ones — each still goes through POST /policies/:id/acknowledge,
// so every policy keeps its own version + time + IP record. Until mandatory
// ones are accepted the server keeps classes, recordings, tests and projects
// locked (requirePoliciesAccepted) and the panel redirects here.
function StudentPolicies() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);
  const [agree, setAgree] = useState(false);
  const [accepting, setAccepting] = useState(false);
  // onboarding checklist: "STEP x OF n" + the batch line of the board header
  const [ob, setOb] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    lmsApi.myOnboarding().then((r) => setOb((r && r.result) || null)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    lmsApi
      .myPolicies()
      .then((r) => setRows((r && r.result) || []))
      .catch(() => message.error('Load failed'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const open = (r) => {
    setView(r);
    if (!r.openedAt) {
      lmsApi.markPolicyOpened(r.policyId).catch(() => {});
      setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, openedAt: new Date().toISOString() } : x)));
    }
  };

  const pending = rows.filter((r) => r.status === 'pending');

  const acceptAll = async () => {
    setAccepting(true);
    let failed = 0;
    for (const r of pending) {
      // eslint-disable-next-line no-await-in-loop
      const res = await lmsApi.acknowledgePolicy(r.policyId).catch(() => null);
      if (!res || res.success === false) failed += 1;
    }
    setAccepting(false);
    setAgree(false);
    window.dispatchEvent(new Event('lms:updates'));
    if (failed) {
      message.error(`${failed} polic${failed === 1 ? 'y' : 'ies'} could not be accepted — please try again.`);
      load();
      return;
    }
    message.success('Policies accepted.');
    navigate('/learn');
  };

  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;

  const chipFor = (r) => {
    if (r.status === 'acknowledged') return <span className="ld-chip hai">Accepted</span>;
    if (r.openedAt) return <span className="ld-chip hai">Read</span>;
    return <span className="ld-chip gray">Not opened</span>;
  };
  const mandatoryPending = pending.filter((r) => r.mandatory !== false).length;
  const stepNo = ob && ob.steps ? ob.steps.findIndex((s) => s.key === 'policies') + 1 : 0;

  // design board L1 — same header, 460px policy list | acknowledgement card
  return (
    <div className="ld-page" style={{ padding: '36px 56px', gap: 20 }}>
      <div className="ld-head">
        <div style={{ gap: 6 }}>
          <div className="ld-eyebrow">{stepNo ? `Step ${stepNo} of ${ob.total} · ` : ''}Account activation</div>
          <h1 style={{ fontSize: 32 }}>{pending.length ? 'Accept the policies before starting the LMS' : 'Policies & agreements'}</h1>
          <div className="ld-muted" style={{ fontSize: 15 }}>
            {mandatoryPending ? 'Until you accept, classes, recordings and tests stay locked — even through a direct link.' : 'You have accepted all required policies.'}
          </div>
        </div>
      </div>

      <div className="ld-grid" style={{ gridTemplateColumns: pending.length ? '460px minmax(0, 1fr)' : 'minmax(0, 720px)', gap: 20, flex: 1 }}>
        <section className="ld-card p20" aria-label="Your policies" style={{ gap: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Policies for you ({rows.length})</div>
          {ob && ob.batch && (
            <div className="ld-muted" style={{ fontSize: 13, marginBottom: 8 }}>Batch: {ob.batch}{ob.batchTime ? ` · ${ob.batchTime}` : ''}</div>
          )}
          {rows.length === 0 ? (
            <div className="ld-empty">No policies have been published for you yet.</div>
          ) : (
            <div>
              {rows.map((r) => (
                <div className="ld-pol" key={r.id}>
                  <span style={{ minWidth: 0 }}>
                    <b>{r.title}</b> <span className="ld-muted">v{r.version}</span>
                    {r.mandatory === false && <span className="ld-muted"> · optional</span>}
                    {r.status === 'acknowledged' && r.acknowledgedAt && <div className="ld-muted" style={{ fontSize: 12 }}>Accepted {dayjs(r.acknowledgedAt).format('D MMM YYYY, HH:mm')}</div>}
                  </span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                    {chipFor(r)}
                    <button type="button" className="ld-link" onClick={() => open(r)}>Open</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {mandatoryPending > 0 && (
            <div className="ld-soft ld-muted" style={{ marginTop: 'auto', padding: 14, borderRadius: 10 }}>
              Locked till accepted: <b style={{ color: '#0f172a' }}>Live Classes · Recordings · Tests · Projects</b>. Support and this page stay open.
            </div>
          )}
        </section>

        {pending.length > 0 && (
          <section className="ld-card p20" aria-label="Learner policy acknowledgement" style={{ gap: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Learner Policy Acknowledgement</div>
            <div style={{ fontSize: 14, lineHeight: '22px', padding: 16, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fcfdfe' }}>
              I confirm that I have been given access to the Learner Policies, LMS Usage Guidelines, Attendance Requirements, Assessment Rules, Communication Guidelines, applicable Course Terms, and Privacy Notice provided by Career Lab Consulting. I have had the opportunity to read them and seek clarification where needed. I agree to follow the applicable policies and use the LMS responsibly. I will keep my login credentials confidential, provide accurate information, follow assessment instructions, and report technical issues through the designated support channels. I understand that mandatory policy acceptance is required before my LMS access is activated.
            </div>
            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 15, cursor: 'pointer' }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 20, height: 20, margin: '2px 0 0' }} />
              <span>I have read all the policies above and I accept them.</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, fontSize: 13 }}>
              <div className="ld-kv"><div className="ld-muted">Saved with acceptance</div><b>Learner ID + version</b></div>
              <div className="ld-kv"><div className="ld-muted">Timestamp</div><b>{dayjs().format('D MMM YYYY')}, IST</b></div>
              <div className="ld-kv"><div className="ld-muted">Audit ref</div><b>Event ID auto</b></div>
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="ld-link" onClick={() => navigate('/learn/support', { state: { raise: { category: 'Other', subject: 'Question about a policy', description: 'Policy name:\nMy question:' } } })}>
                Something unclear? Ask Support
              </button>
              <button type="button" className="ld-btn" style={{ fontSize: 15, padding: '0 20px' }} disabled={!agree || accepting} onClick={acceptAll}>
                {accepting ? 'Accepting…' : 'Accept & continue →'}
              </button>
            </div>
          </section>
        )}
      </div>

      <Modal open={!!view} title={view ? `${view.title} · v${view.version}` : ''} width={680} destroyOnClose onCancel={() => setView(null)} footer={<Button onClick={() => setView(null)}>Close</Button>}>
        <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e3e8ef', borderRadius: 8, padding: 14, marginBottom: 12, whiteSpace: 'pre-wrap' }}>
          {view?.content || 'No content provided.'}
        </div>
        {view?.fileUrl && (
          <p>
            <a href={view.fileUrl} target="_blank" rel="noopener noreferrer">
              View attached document
            </a>
          </p>
        )}
        {view?.effectiveDate && <Text type="secondary">Effective from {dayjs(view.effectiveDate).format('D MMM YYYY')}</Text>}
      </Modal>
    </div>
  );
}

export default function Policies() {
  const admin = useSelector(selectCurrentAdmin) || {};
  // Staff read published policies here; creating / publishing lives in
  // Admin & Ops → Policy centre.
  if (MGR.includes(admin.role) || LMS_TEACHER_ROLES.includes(admin.role)) return <ViewPolicies />;
  return <StudentPolicies />;
}
