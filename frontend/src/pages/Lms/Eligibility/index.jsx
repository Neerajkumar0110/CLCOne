import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Space, Empty, Skeleton, message, Typography, Select, InputNumber, Checkbox, Row, Col, Progress, Divider, Alert, List, Tabs, Modal, Input,
} from 'antd';
import {
  SafetyCertificateOutlined, ReloadOutlined, SaveOutlined, CheckOutlined, CalendarOutlined, ReadOutlined,
  FileDoneOutlined, QuestionCircleOutlined, ThunderboltOutlined, ProjectOutlined, EyeOutlined,
  WarningOutlined, CheckCircleOutlined, CloseCircleOutlined, PlusOutlined, SearchOutlined, TeamOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';
import { LearnerListControls, useLearnerList } from '../components/LearnerListControls';
import './Eligibility.css';
import '../Policies/policyDesign.css';
import { tablePagination } from '../components/ui';

const { Text, Paragraph } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

// Kept in sync by hand with backend/src/services/lms/eligibilityEngine.js
// DEFAULT_CRITERIA (same convention as config/roles.js).
const DEFAULT_CRITERIA = [
  { key: 'attendance', label: 'Attendance', enabled: true, mandatory: true, minPercent: 90, weight: 2 },
  { key: 'curriculum', label: 'Curriculum completion', enabled: true, mandatory: true, minPercent: 100, weight: 2 },
  { key: 'assignment', label: 'Assignments evaluated', enabled: true, mandatory: true, minPercent: 100, weight: 1 },
  { key: 'quiz', label: 'Quiz average score', enabled: true, mandatory: true, minPercent: 60, weight: 1 },
  { key: 'surpriseTest', label: 'Surprise tests', enabled: true, mandatory: false, minPercent: 60, weight: 1 },
  { key: 'acknowledgement', label: 'Policy acknowledgements', enabled: true, mandatory: true, minPercent: 100, weight: 1 },
  { key: 'project', label: 'Project approval', enabled: false, mandatory: false, minPercent: 100, weight: 1 },
  { key: 'proctoredAssessment', label: 'Proctored assessment', enabled: false, mandatory: false, minPercent: 60, weight: 1 },
];

const STATE_COLOR = { Eligible: 'green', 'Not Yet Eligible': 'gold', 'Action Required': 'red' };

// Per-criterion icon + accent colour for the student "My Eligibility" cards —
// keyed off DEFAULT_CRITERIA's `key`, with a safe fallback for anything a
// course's saved rule adds later (e.g. a custom criterion key).
const REQ_ICON = {
  attendance: { icon: <CalendarOutlined />, color: 'blue' },
  curriculum: { icon: <ReadOutlined />, color: 'purple' },
  assignment: { icon: <FileDoneOutlined />, color: 'green' },
  quiz: { icon: <QuestionCircleOutlined />, color: 'orange' },
  surpriseTest: { icon: <ThunderboltOutlined />, color: 'orange' },
  acknowledgement: { icon: <SafetyCertificateOutlined />, color: 'blue' },
  project: { icon: <ProjectOutlined />, color: 'purple' },
  proctoredAssessment: { icon: <EyeOutlined />, color: 'red' },
};
const reqMeta = (key) => REQ_ICON[key] || { icon: <CheckCircleOutlined />, color: 'blue' };

const STATE_BADGE = {
  Eligible: { className: 'eligible', icon: <CheckCircleOutlined /> },
  'Not Yet Eligible': { className: 'not-yet', icon: <WarningOutlined /> },
  'Action Required': { className: 'action', icon: <CloseCircleOutlined /> },
};

/* ═══════════ MANAGER / TEACHER — configure + report ═══════════ */
function ManageEligibility({ canEdit }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [threshold, setThreshold] = useState(90);
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  // 2026-11-27: two tabs (report | criteria); a candidate's full report opens in a modal
  const [tab, setTab] = useState('report');
  const [view, setView] = useState(null);
  const [q, setQ] = useState('');
  const [stateF, setStateF] = useState('all');

  useEffect(() => {
    (async () => {
      try {
        const [c, d] = await Promise.all([
          request.list({ entity: 'course', options: { items: 300 } }),
          lmsApi.teacherDashboard().catch(() => null),
        ]);
        let list = ((c && c.result) || []).map((x) => ({ value: x._id || x.id, label: x.title }));
        if (!canEdit && d && d.result && d.result.courses) {
          // teacher without edit rights: still narrow to their own courses
          const mine = new Set(d.result.courses.map((x) => x.id));
          list = list.filter((o) => mine.has(o.value));
        }
        setCourses(list);
        if (list[0]) setCourseId(list[0].value);
      } catch (e) { message.error('Load failed'); } finally { setLoading(false); }
    })();
  }, [canEdit]);

  const loadRule = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await lmsApi.eligibilityRule(id);
      const r = (res && res.result) || {};
      setCriteria(Array.isArray(r.criteria) && r.criteria.length ? r.criteria : DEFAULT_CRITERIA);
      setThreshold(r.overallThresholdPercent || 90);
    } catch (e) { /* */ }
  }, []);
  useEffect(() => { loadRule(courseId); }, [courseId, loadRule]);

  const loadReport = useCallback(async () => {
    if (!courseId) return;
    setRunning(true);
    try {
      const res = await lmsApi.eligibilityCourseReport(courseId);
      setReport((res && res.result) || []);
    } catch (e) { message.error('Report failed'); } finally { setRunning(false); }
  }, [courseId]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const updateCriterion = (key, patch) => setCriteria((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await lmsApi.saveEligibilityRule(courseId, { criteria, overallThresholdPercent: threshold, enabled: true });
      message.success(res?.message || 'Saved');
      loadReport();
    } catch (e) { message.error('Save failed'); } finally { setSaving(false); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  const needle = q.trim().toLowerCase();
  const counts = report.reduce((m, r) => ({ ...m, [r.state]: (m[r.state] || 0) + 1 }), {});
  const shownReport = report.filter((r) => (stateF === 'all' || r.state === stateF) && (!needle || `${r.student} ${r.email || ''}`.toLowerCase().includes(needle)));
  const learner360 = (id) => `${String(window.location.pathname).startsWith('/teacher') ? '/teacher/growth/learner-360' : '/learner-growth/learner-360'}?learner=${id}`;

  const reportTab = (
    <div className="elg-tab">
      <div className="elg-stats">
        {[['all', 'All candidates', report.length, 'violet'], ['Eligible', 'Eligible', counts.Eligible || 0, 'teal'], ['Not Yet Eligible', 'Not yet eligible', counts['Not Yet Eligible'] || 0, 'amber'], ['Action Required', 'Action required', counts['Action Required'] || 0, 'red']].map(([k, label, n, tone]) => (
          <button key={k} type="button" className={`elg-stat ${tone}${stateF === k ? ' on' : ''}`} onClick={() => setStateF(k)}>
            <b>{n}</b><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="elg-tools">
        <Input allowClear prefix={<SearchOutlined />} placeholder="Search candidate" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <Button icon={<ReloadOutlined />} loading={running} onClick={loadReport}>Refresh</Button>
      </div>
      <Table
        rowKey={(r) => r.id || r.email}
        pagination={tablePagination({ defaultPageSize: 10 })}
        dataSource={shownReport}
        loading={running && !report.length}
        locale={{ emptyText: report.length ? 'No candidate in this filter' : 'No enrolled candidates yet' }}
        onRow={(r) => ({ onClick: () => setView(r), style: { cursor: 'pointer' } })}
        scroll={{ x: 640 }}
        columns={[
          { title: 'Candidate', dataIndex: 'student', render: (v, r) => <span className="elg-name"><b>{v}</b>{r.email && <small>{r.email}</small>}</span> },
          {
            title: 'Score',
            width: 220,
            render: (_, r) => (
              <div className="elg-score">
                <Progress percent={Math.min(100, Number(r.score) || 0)} showInfo={false} size="small" strokeColor={r.score >= r.threshold ? '#14b8a6' : '#f59e0b'} />
                <span><b>{r.score}%</b> / {r.threshold}%</span>
              </div>
            ),
          },
          { title: 'Status', dataIndex: 'state', width: 150, render: (v) => <Tag color={STATE_COLOR[v]}>{v}</Tag> },
          { title: 'Still needed', width: 120, render: (_, r) => ((r.missing || []).length ? <span className="elg-miss">{r.missing.length} item{r.missing.length === 1 ? '' : 's'}</span> : <span className="elg-ok">—</span>) },
          { title: '', width: 90, render: (_, r) => <Button size="small" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); setView(r); }}>View</Button> },
        ]}
      />
    </div>
  );

  const criteriaTab = (
    <div className="elg-tab">
      <Card size="small" title="Criteria (mandatory gate + weighted score)">
        <Table
          rowKey="key" size="small" pagination={false} dataSource={criteria} scroll={{ x: 520 }}
          columns={[
            { title: 'Criterion', dataIndex: 'label', width: 190 },
            { title: 'On', dataIndex: 'enabled', width: 50, render: (v, r) => <Checkbox disabled={!canEdit} checked={v !== false} onChange={(e) => updateCriterion(r.key, { enabled: e.target.checked })} /> },
            { title: 'Mandatory', dataIndex: 'mandatory', width: 90, render: (v, r) => <Checkbox disabled={!canEdit} checked={!!v} onChange={(e) => updateCriterion(r.key, { mandatory: e.target.checked })} /> },
            { title: 'Min %', dataIndex: 'minPercent', width: 90, render: (v, r) => <InputNumber disabled={!canEdit} size="small" min={0} max={100} value={v} onChange={(val) => updateCriterion(r.key, { minPercent: val })} /> },
            { title: 'Weight', dataIndex: 'weight', width: 80, render: (v, r) => <InputNumber disabled={!canEdit} size="small" min={0} value={v} onChange={(val) => updateCriterion(r.key, { weight: val })} /> },
          ]}
        />
        <Divider style={{ margin: '12px 0' }} />
        <Space align="center" wrap>
          <Text strong>Overall eligibility threshold</Text>
          <InputNumber disabled={!canEdit} min={0} max={100} value={threshold} onChange={setThreshold} addonAfter="%" />
          {canEdit && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save rule</Button>}
        </Space>
      </Card>
    </div>
  );

  const v = view;
  const pass = v ? (v.items || []).filter((it) => it.applicable && it.passed).length : 0;
  const appl = v ? (v.items || []).filter((it) => it.applicable).length : 0;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><SafetyCertificateOutlined /> Eligibility / Placement Readiness</h2><p>Configure the criteria, weights and threshold — every candidate's status is computed live, never hand-tracked.</p></div>
        <Select style={{ minWidth: 240 }} value={courseId} onChange={setCourseId} options={courses} placeholder="Internship" />
      </div>

      {!courseId ? <Card><Empty description="No internships." /></Card> : (
        <Tabs
          className="elg-tabs"
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'report', label: <span><TeamOutlined /> Live candidate report <span className="elg-badge">{report.length}</span></span>, children: reportTab },
            { key: 'criteria', label: <span><SettingOutlined /> Criteria &amp; threshold</span>, children: criteriaTab },
          ]}
        />
      )}

      <Modal open={!!v} onCancel={() => setView(null)} footer={null} width={760} centered destroyOnClose rootClassName="pol-modal">
        {v && (
          <div className="pol-m">
            <div className={`pol-m-head elg-head ${v.state === 'Eligible' ? 'ok' : v.state === 'Action Required' ? 'bad' : 'mid'}`}>
              <div className="elg-head-row">
                <div style={{ minWidth: 0 }}>
                  <div className="pol-m-tags"><Tag color={STATE_COLOR[v.state]} style={{ margin: 0 }}>{v.state}</Tag><span className="pol-chip">{pass}/{appl} criteria met</span></div>
                  <h3 style={{ marginTop: 8 }}>{v.student}</h3>
                  {v.email && <div className="pol-m-meta"><span>{v.email}</span></div>}
                </div>
                <Progress type="circle" size={84} percent={Math.min(100, Number(v.score) || 0)} format={() => <span className="elg-ring"><b>{v.score}%</b><small>of {v.threshold}%</small></span>} strokeColor={v.score >= v.threshold ? '#14b8a6' : '#f59e0b'} />
              </div>
            </div>
            <div className="pol-m-body">
              <section className="pol-box">
                <div className="pol-cap">Criteria · required vs achieved</div>
                <div className="elg-crit">
                  {(v.items || []).map((it) => {
                    const st = !it.applicable ? 'na' : it.passed ? 'pass' : it.mandatory ? 'fail' : 'warn';
                    const pct = it.applicable ? Math.min(100, Number(it.achieved) || 0) : 0;
                    return (
                      <div key={it.key} className={`elg-c ${st}`}>
                        <span className="elg-c-ic">{reqMeta(it.key).icon}</span>
                        <div className="elg-c-main">
                          <div className="elg-c-top">
                            <b>{it.label}{it.mandatory && <span className="elg-req" title="Mandatory"> *</span>}</b>
                            <span className="elg-c-val">{it.applicable ? <><b>{it.achieved}%</b> / {it.required}%</> : <>— / {it.required}%</>}</span>
                          </div>
                          <div className="elg-trk"><div style={{ width: `${pct}%` }} /><i style={{ left: `${Math.min(100, it.required)}%` }} /></div>
                        </div>
                        <span className={`elg-pill ${st}`}>{st === 'na' ? 'n/a' : st === 'pass' ? 'Pass' : 'Below'}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="pol-note"><span className="elg-req">*</span> mandatory — must be met regardless of the overall score · the line on each bar is the required level</div>
              </section>
              {(v.missing || []).length > 0 && (
                <div className="pol-alert bad"><WarningOutlined /><span><b>Still needed:</b> {v.missing.join(', ')}</span></div>
              )}
              {v.state === 'Eligible' && <div className="pol-alert ok"><CheckCircleOutlined /><span><b>Eligible</b> · all mandatory criteria met and the score is above the threshold.</span></div>}
            </div>
            <div className="pol-m-foot">
              <span className="pol-note">Computed live from attendance, curriculum, assignments, quizzes and policies</span>
              <div className="pol-m-foot-r">
                {v.id && <Button href={learner360(v.id)}>Open full Learner 360 report →</Button>}
                <Button type="primary" onClick={() => setView(null)}>Close</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ═══════════ STUDENT — my eligibility ═══════════ */
function MyEligibility() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const list = useLearnerList(rows, {
    getSearchText: (r) => [r.course && r.course.title, r.state].filter(Boolean).join(' '),
    getFilterValue: (r) => (r.eligible ? 'eligible' : 'ineligible'),
  });
  useEffect(() => {
    lmsApi.myEligibility().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="elig-page">
      <div className="elig-hero">
        <div className="elig-hero-icon">
          <SafetyCertificateOutlined />
          <span className="elig-check"><CheckOutlined /></span>
        </div>
        <div className="elig-hero-content">
          <h1>My Eligibility</h1>
          <p>Your placement-readiness status — computed live from attendance, assessments, quizzes and policy acknowledgements.</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="elig-empty"><Empty description="Not enrolled in any internship yet." /></div>
      ) : (
      <>
      <LearnerListControls
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search internships…"
        filter={list.filter}
        onFilterChange={list.setFilter}
        filterPlaceholder="All eligibility statuses"
        filterOptions={[{ value: 'eligible', label: 'Eligible' }, { value: 'ineligible', label: 'Not eligible' }]}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
      />
      {list.total === 0 ? <Empty description="No internships match these filters." /> : list.pageRows.map((r) => {
        const badge = STATE_BADGE[r.state] || STATE_BADGE['Not Yet Eligible'];
        return (
          <div className="elig-card" key={r.course.id}>
            <div className="elig-card-head">
              <div className="elig-course-icon"><ReadOutlined /></div>
              <h3>{r.course.title}</h3>
              <span className={`elig-status-badge ${badge.className}`}>{badge.icon} {r.state}</span>
            </div>

            <div className="elig-score-row">
              <div className="elig-ring">
                <Progress type="circle" size={110} percent={r.score} strokeWidth={8} strokeColor="#2875e8" trailColor="#e7edf6" status={r.eligible ? 'success' : 'normal'} />
              </div>
              <div className="elig-score-info">
                <p>Current score <b>{r.score}%</b> – required <b>{r.threshold}%</b></p>
                {r.missing.length > 0 && (
                  <div className="elig-missing-card">
                    <span className="elig-missing-icon"><WarningOutlined /></span>
                    <div>
                      <strong>Still needed to become eligible</strong>
                      <p>{r.missing.join(', ')}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="elig-reqs">
              {r.items.filter((i) => i.applicable).map((i) => {
                const meta = reqMeta(i.key);
                return (
                  <div className="elig-req-row" key={i.key || i.label}>
                    <div className={`elig-req-icon ${meta.color}`}>{meta.icon}</div>
                    <div className="elig-req-label">
                      {i.label}
                      {i.mandatory && <span className="elig-mandatory-tag">Mandatory</span>}
                    </div>
                    <div className={`elig-req-score ${i.passed ? 'pass' : 'fail'}`}>
                      {i.achieved}%<span>/ {i.required}% required</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </>
      )}
    </div>
  );
}

export default function Eligibility() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role)) return <ManageEligibility canEdit />;
  if (LMS_TEACHER_ROLES.includes(admin.role)) return <ManageEligibility canEdit={false} />;
  return <MyEligibility />;
}
