import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Space, Empty, Skeleton, message, Typography, Select, InputNumber, Checkbox, Row, Col, Progress, Divider, Alert, List,
} from 'antd';
import {
  SafetyCertificateOutlined, ReloadOutlined, SaveOutlined, CheckOutlined, CalendarOutlined, ReadOutlined,
  FileDoneOutlined, QuestionCircleOutlined, ThunderboltOutlined, ProjectOutlined, EyeOutlined,
  WarningOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';
import './Eligibility.css';

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

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><SafetyCertificateOutlined /> Eligibility / Placement Readiness</h2><p>Configure the criteria, weights and threshold — every candidate's status is computed live, never hand-tracked.</p></div>
        <Select style={{ minWidth: 240 }} value={courseId} onChange={setCourseId} options={courses} placeholder="Course" />
      </div>

      {!courseId ? <Card><Empty description="No courses." /></Card> : (
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={14}>
            <Card size="small" title="Criteria (mandatory gate + weighted score)">
              <Table
                rowKey="key" size="small" pagination={false} dataSource={criteria}
                columns={[
                  { title: 'Criterion', dataIndex: 'label', width: 190 },
                  { title: 'On', dataIndex: 'enabled', width: 50, render: (v, r) => <Checkbox disabled={!canEdit} checked={v !== false} onChange={(e) => updateCriterion(r.key, { enabled: e.target.checked })} /> },
                  { title: 'Mandatory', dataIndex: 'mandatory', width: 90, render: (v, r) => <Checkbox disabled={!canEdit} checked={!!v} onChange={(e) => updateCriterion(r.key, { mandatory: e.target.checked })} /> },
                  { title: 'Min %', dataIndex: 'minPercent', width: 90, render: (v, r) => <InputNumber disabled={!canEdit} size="small" min={0} max={100} value={v} onChange={(val) => updateCriterion(r.key, { minPercent: val })} /> },
                  { title: 'Weight', dataIndex: 'weight', width: 80, render: (v, r) => <InputNumber disabled={!canEdit} size="small" min={0} value={v} onChange={(val) => updateCriterion(r.key, { weight: val })} /> },
                ]}
              />
              <Divider style={{ margin: '12px 0' }} />
              <Space align="center">
                <Text strong>Overall eligibility threshold</Text>
                <InputNumber disabled={!canEdit} min={0} max={100} value={threshold} onChange={setThreshold} addonAfter="%" />
                {canEdit && <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save rule</Button>}
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card size="small" title="Live candidate report" extra={<Button size="small" icon={<ReloadOutlined />} loading={running} onClick={loadReport}>Refresh</Button>}>
              <Table
                rowKey="email" size="small" pagination={{ pageSize: 10 }} dataSource={report}
                locale={{ emptyText: 'No enrolled candidates yet' }}
                columns={[
                  { title: 'Candidate', dataIndex: 'student' },
                  { title: 'Score', render: (_, r) => `${r.score}% / ${r.threshold}%` },
                  { title: 'Status', dataIndex: 'state', render: (v) => <Tag color={STATE_COLOR[v]}>{v}</Tag> },
                ]}
                expandable={{
                  rowExpandable: (r) => r.missing && r.missing.length > 0,
                  expandedRowRender: (r) => <Paragraph style={{ margin: 0 }} type="secondary">Missing: {r.missing.join(', ')}</Paragraph>,
                }}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}

/* ═══════════ STUDENT — my eligibility ═══════════ */
function MyEligibility() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
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
        <div className="elig-empty"><Empty description="Not enrolled in any course yet." /></div>
      ) : rows.map((r) => {
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
    </div>
  );
}

export default function Eligibility() {
  const admin = useSelector(selectCurrentAdmin) || {};
  if (MGR.includes(admin.role)) return <ManageEligibility canEdit />;
  if (LMS_TEACHER_ROLES.includes(admin.role)) return <ManageEligibility canEdit={false} />;
  return <MyEligibility />;
}
