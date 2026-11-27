import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, Select, Checkbox, Space, Empty, Skeleton, message, Typography, DatePicker, Progress, Drawer, Alert, Popconfirm,
} from 'antd';
import {
  FileProtectOutlined, PlusOutlined, CloudUploadOutlined, InboxOutlined, EyeOutlined, DeleteOutlined,
  TagOutlined, AppstoreOutlined, FileTextOutlined, LinkOutlined, CalendarOutlined, TeamOutlined, CheckSquareOutlined, SearchOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';
import NewPolicyModal, { confirmDeletePolicy } from './NewPolicyModal';
import '../StudentDashboard/StudentHome.css';
import '../components/LearnerDesign.css';
import './StudentConsent.css';
import './policyDesign.css';
import { PolicyBody } from './PolicyConsentModal';
import './policyConsent.css';

const { Text, Paragraph } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

/* ═══════════ STAFF — published policies (cards + read modal) ═══════════ */
const AUDIENCE = { all: 'All candidates', course: 'One internship', batch: 'One batch' };
const fmtD = (d) => (d ? dayjs(d).format('D MMM YYYY') : '');
const audienceOf = (r) => [AUDIENCE[r.audience] || 'All candidates', r.batch, r.courseTitle].filter(Boolean).join(' · ');

export function PolicyReadModal({ policy, onClose, onDeleted }) {
  const r = policy;
  return (
    <Modal open={!!r} onCancel={onClose} footer={null} width={820} centered destroyOnClose rootClassName="pol-modal">
      {r && (
        <div className="pol-m">
          <div className="pol-m-head">
            <div className="pol-m-tags">
              <span className="pol-chip teal">v{r.version}</span>
              {r.category && <span className="pol-chip blue">{r.category}</span>}
              {r.status && r.status !== 'published' ? <span className="pol-chip amber">{r.status}</span> : <span className="pol-chip green">Live</span>}
              {r.mandatory !== false ? <span className="pol-chip red">Mandatory</span> : <span className="pol-chip">Optional</span>}
              {r.byAdmin && <span className="pol-chip violet">Admin policy · no approval needed</span>}
            </div>
            <h3>{r.title}</h3>
            <div className="pol-m-meta">
              <span><TeamOutlined /> {audienceOf(r)}</span>
              {r.effectiveDate && <span><CalendarOutlined /> Effective {fmtD(r.effectiveDate)}</span>}
              {r.publishedAt && <span><CheckSquareOutlined /> Published {fmtD(r.publishedAt)}</span>}
            </div>
          </div>
          <div className="pol-m-body">
            {r.fileUrl && (
              <a className="pol-doc" href={r.fileUrl} target="_blank" rel="noopener noreferrer">
                <span className="pol-doc-ic"><FileTextOutlined /></span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{decodeURIComponent(String(r.fileUrl).split('/').pop())}</span>
                <span style={{ marginLeft: 'auto', flex: 'none' }}>Open document →</span>
              </a>
            )}
            <div className="pol-m-text">{r.content || 'No policy text.'}</div>
          </div>
          <div className="pol-m-foot">
            <span className="pol-note">Learners see this text with an unticked checkbox · acceptance saves learner ID + version + time</span>
            <div className="pol-m-foot-r">
              {onDeleted && <Button danger icon={<DeleteOutlined />} onClick={() => confirmDeletePolicy(r, () => onDeleted(r))}>Delete</Button>}
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ViewPolicies({ canCreate, canDelete }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const navigate = useNavigate();
  const load = () =>
    lmsApi.listPolicies({ status: 'published' }).then((r) => {
      // newest published version per policy
      const by = new Map();
      ((r && r.result) || []).forEach((x) => {
        const k = x.slug || x.id;
        if (!by.has(k) || (by.get(k).version || 0) < (x.version || 0)) by.set(k, x);
      });
      setRows([...by.values()]);
    }).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // an Admin's policy is live at once (the modal already said "Published to N");
  // Support's is a draft that still needs an Admin's approval
  const created = (newId, direct) => {
    setCreating(false);
    if (direct) load();
    else message.info('Draft saved — open “Publish & track”, choose an Admin and send it for approval.', 6);
  };
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!cat || r.category === cat) && (!needle || `${r.title} ${r.category} ${r.content}`.toLowerCase().includes(needle)));
  return (
    <div className="pol">
      <div className="pol-hero">
        <div className="pol-hero-l">
          <span className="pol-hero-ic"><FileProtectOutlined /></span>
          <div>
            <h2>Policies</h2>
            <p>{canCreate ? 'Live policies learners have to read and accept. A new policy starts as a draft and goes live from “Publish & track” after approval.' : 'Live policies (view only — managed by admin).'}</p>
          </div>
        </div>
        {canCreate && <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New policy</Button>}
      </div>

      <div className="pol-stats">
        <div className="pol-stat"><span className="pol-stat-ic teal"><FileProtectOutlined /></span><div><b>{rows.length}</b><span>Live policies</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic amber"><CheckSquareOutlined /></span><div><b>{rows.filter((r) => r.mandatory !== false).length}</b><span>Mandatory</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic blue"><AppstoreOutlined /></span><div><b>{cats.length}</b><span>Categories</span></div></div>
        <div className="pol-stat"><span className="pol-stat-ic violet"><LinkOutlined /></span><div><b>{rows.filter((r) => r.fileUrl).length}</b><span>With document</span></div></div>
      </div>

      {canCreate && <NewPolicyModal open={creating} onClose={() => setCreating(false)} onCreated={created} />}

      {rows.length === 0 ? (
        <div className="pol-empty">
          <span className="pol-empty-ic"><FileProtectOutlined /></span>
          <b>No live policy yet</b>
          <span>{canCreate ? 'Write a policy with “New policy”. It is saved as a draft — send it for approval and publish it from “Publish & track”, then it shows here.' : 'Nothing has been published yet.'}</span>
          {canCreate && (
            <Space wrap style={{ justifyContent: 'center' }}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New policy</Button>
              <Button onClick={() => navigate({ search: '?view=publish' })}>Open Publish &amp; track</Button>
            </Space>
          )}
        </div>
      ) : (
        <>
          <div className="pol-tools">
            <Input allowClear prefix={<SearchOutlined />} placeholder="Search policies" value={q} onChange={(e) => setQ(e.target.value)} />
            {cats.length > 1 && (
              <div className="pol-pills">
                <button type="button" className={`pol-pill${!cat ? ' on' : ''}`} onClick={() => setCat('')}>All · {rows.length}</button>
                {cats.map((c) => <button key={c} type="button" className={`pol-pill${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c} · {rows.filter((r) => r.category === c).length}</button>)}
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="pol-empty"><span className="pol-empty-ic"><SearchOutlined /></span><b>No match</b><span>Try another word or category.</span></div>
          ) : (
            <div className="pol-grid">
              {shown.map((r) => (
                <button key={r.id} type="button" className="pol-card" onClick={() => setView(r)}>
                  <div className="pol-card-top">
                    <span className="pol-card-ic"><FileTextOutlined /></span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span className="pol-chip teal">v{r.version}</span>
                      {r.byAdmin && <span className="pol-chip violet">Admin policy</span>}
                      {r.mandatory !== false && <span className="pol-chip red">Mandatory</span>}
                    </span>
                  </div>
                  <h3>{r.title}</h3>
                  <div className="pol-card-x">{r.content}</div>
                  <div className="pol-card-f">
                    {r.category && <span className="pol-chip blue">{r.category}</span>}
                    {r.effectiveDate && <span><CalendarOutlined /> {fmtD(r.effectiveDate)}</span>}
                    {r.fileUrl && <span><LinkOutlined /> Document</span>}
                    <span className="go">Read →</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      <PolicyReadModal
        policy={view}
        onClose={() => setView(null)}
        onDeleted={canDelete ? (r) => { setView(null); setRows((xs) => xs.filter((x) => (x.slug || x.id) !== (r.slug || r.id))); } : undefined}
      />
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
  // 2026-11-27: view-only. Accepting happens in PolicyConsentModal (opened by
  // the panel over every page while a policy is pending); here the learner
  // re-reads what they already agreed to.
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(null);
  const [q, setQ] = useState('');

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
    window.addEventListener('lms:updates', load);
    return () => window.removeEventListener('lms:updates', load);
  }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;

  const accepted = rows.filter((r) => r.status === 'acknowledged');
  const pendingN = rows.length - accepted.length;
  const needle = q.trim().toLowerCase();
  const shown = accepted.filter((r) => !needle || `${r.title} ${r.category || ''}`.toLowerCase().includes(needle));

  return (
    <div className="ld-page spv" style={{ gap: 18 }}>
      <div className="spv-hero">
        <span className="spv-hero-ic"><FileProtectOutlined /></span>
        <div style={{ minWidth: 0 }}>
          <span className="spv-kicker">My policies</span>
          <h1>Policies you have accepted</h1>
          <p>Open any policy to read it again. New policies appear as a pop-up to accept — they show up here once you agree.</p>
        </div>
        <div className="spv-stats">
          <span><b>{accepted.length}</b><small>accepted</small></span>
          {pendingN > 0 && <span className="warn"><b>{pendingN}</b><small>to accept</small></span>}
        </div>
      </div>

      {accepted.length > 0 && (
        <div className="spv-tools">
          <Input allowClear prefix={<SearchOutlined />} placeholder="Search policies" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        </div>
      )}

      {accepted.length === 0 ? (
        <div className="spv-empty"><FileProtectOutlined /><b>No accepted policies yet</b><span>{pendingN ? 'Accept the policy shown in the pop-up — it will then be listed here.' : 'No policies have been published for you yet.'}</span></div>
      ) : (
        <div className="spv-grid">
          {shown.map((r) => (
            <button type="button" key={r.id} className="spv-card" onClick={() => setView(r)}>
              <span className="spv-card-top">
                <span className="spv-card-ic"><FileTextOutlined /></span>
                <span className="spv-chips">
                  <span className="spv-chip v">v{r.version}</span>
                  <span className="spv-chip ok"><CheckCircleOutlined /> Accepted</span>
                </span>
              </span>
              <b className="spv-title">{r.title}</b>
              {r.category && <span className="spv-cat">{r.category}</span>}
              <span className="spv-foot">
                <span>{r.acknowledgedAt ? `Accepted ${dayjs(r.acknowledgedAt).format('D MMM YYYY, HH:mm')}` : ''}</span>
                <span className="spv-view"><EyeOutlined /> View</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <Modal open={!!view} title={null} width={820} centered destroyOnClose onCancel={() => setView(null)} footer={null} rootClassName="pcm-root">
        {view && (
          <div className="pcm">
            <div className="pcm-head">
              <span className="pcm-ic"><FileProtectOutlined /></span>
              <div style={{ minWidth: 0 }}>
                <span className="pcm-kicker" style={{ color: '#a7f3d0' }}><CheckCircleOutlined /> Accepted{view.acknowledgedAt ? ` · ${dayjs(view.acknowledgedAt).format('D MMM YYYY, HH:mm')}` : ''}</span>
                <h3>{view.title}</h3>
                <span className="pcm-sub">Version {view.version}{view.category ? ` · ${view.category}` : ''}{view.effectiveDate ? ` · effective ${dayjs(view.effectiveDate).format('D MMM YYYY')}` : ''}</span>
              </div>
            </div>
            <div className="pcm-body"><PolicyBody p={view} tall /></div>
            <div className="pcm-foot"><span className="pcm-note" style={{ padding: 0 }}>Read-only copy of the version you accepted.</span><Button type="primary" onClick={() => setView(null)}>Close</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function Policies() {
  const admin = useSelector(selectCurrentAdmin) || {};
  // Staff read published policies here; creating / publishing lives in
  // Admin & Ops → Policy centre.
  // managers (Support included — the API allows it) write new policies here too
  if (MGR.includes(admin.role) || LMS_TEACHER_ROLES.includes(admin.role)) return <ViewPolicies canCreate={MGR.includes(admin.role)} canDelete={['owner', 'Super Admin', 'Admin'].includes(admin.role)} />;
  return <StudentPolicies />;
}
