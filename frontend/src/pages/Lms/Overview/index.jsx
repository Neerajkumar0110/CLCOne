import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tag, Progress, Empty, Skeleton, Alert, List, Typography } from 'antd';
import {
  TrophyOutlined,
  CheckSquareOutlined,
  FileTextOutlined,
  ExperimentOutlined,
  ProjectOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import lmsApi from '../api';
import KpiTile from '../components/KpiTile';

const { Text } = Typography;

// Spec §3 "Learner Portal — every learner should have a single dashboard
// showing their complete academic and placement-readiness record, with an
// 'Overall Eligibility/Progress' card at top." Every number here already
// existed on its own page (Attendance, Results, Quizzes, Projects, Policies,
// Certificates) — this is the missing "home" view that puts them together,
// backed by GET /api/lms/my/overview (learnerOverview.js).

const STATE_COLOR = { Eligible: 'green', 'Not Yet Eligible': 'orange', 'Action Required': 'red' };

export default function LearnerOverview() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [d, setD] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await lmsApi.myOverview();
        if (alive) setD((res && res.result) || null);
      } catch (e) {
        if (alive) setErr('Could not load your overview.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;
  if (err) return <Alert type="error" showIcon message={err} style={{ margin: 24 }} />;
  if (!d) return <Empty style={{ marginTop: 80 }} description="Nothing to show yet." />;

  const elig = d.eligibility;
  const attendance = d.attendance && d.attendance.summary;
  const assessments = d.assessments || {};
  const assessmentResults = assessments.results || [];
  const qualifiedCount = assessmentResults.filter((r) => r.qualified === true).length;
  const quizzes = Array.isArray(d.quizzes) ? d.quizzes : d.quizzes?.result || [];
  const quizzesCompleted = quizzes.filter((q) => q.attemptsUsed > 0).length;
  const projects = Array.isArray(d.projects) ? d.projects : d.projects?.result || [];
  const projectsApproved = projects.filter((p) => p.status === 'approved').length;
  const policies = Array.isArray(d.policies) ? d.policies : d.policies?.result || [];
  const policiesPending = policies.filter((p) => p.status !== 'acknowledged').length;
  const certificates = Array.isArray(d.certificates) ? d.certificates : d.certificates?.result || [];
  const notifications = d.notifications || {};

  return (
    <div className="lms-portal lms-dashboard-shell" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><TrophyOutlined /> My Overview</h2>
          <p>Your complete academic and placement-readiness record, in one place.</p>
        </div>
      </div>

      {/* Overall Eligibility / Progress card */}
      <Card
        bordered
        style={{ marginTop: 12 }}
        title={elig ? `Overall Eligibility — ${elig.course?.title || ''}` : 'Overall Eligibility'}
      >
        {!elig ? (
          <Empty description="No eligibility rule configured for your course yet." />
        ) : (
          <>
            <Row gutter={[16, 16]} align="middle">
              <Col xs={24} md={6}>
                <Progress
                  type="dashboard"
                  percent={elig.score}
                  status={elig.eligible ? 'success' : 'normal'}
                  format={(p) => `${p}%`}
                />
              </Col>
              <Col xs={24} md={18}>
                <p style={{ marginBottom: 6 }}>
                  <Tag color={STATE_COLOR[elig.state] || 'default'} style={{ fontSize: 13, padding: '4px 10px' }}>
                    {elig.state}
                  </Tag>
                  <Text style={{ marginLeft: 10 }}>
                    Score <b>{elig.score}%</b> · Required <b>{elig.threshold}%</b>
                  </Text>
                </p>
                {elig.missing && elig.missing.length > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    message="Still needed to become eligible"
                    description={<List size="small" dataSource={elig.missing} renderItem={(m) => <List.Item>{m}</List.Item>} />}
                  />
                )}
              </Col>
            </Row>
            <Table
              style={{ marginTop: 16 }}
              size="small"
              rowKey="key"
              dataSource={elig.items || []}
              pagination={false}
              columns={[
                { title: 'Criterion', dataIndex: 'label' },
                { title: 'Mandatory', dataIndex: 'mandatory', render: (v) => (v ? <Tag color="red">Mandatory</Tag> : <Tag>Optional</Tag>) },
                { title: 'Required %', dataIndex: 'required' },
                { title: 'Achieved %', dataIndex: 'achieved' },
                { title: 'Status', dataIndex: 'passed', render: (v, r) => (!r.applicable ? <Tag>N/A</Tag> : v ? <Tag color="green">Passed</Tag> : <Tag color="red">Not met</Tag>) },
              ]}
            />
          </>
        )}
      </Card>

      <Row gutter={[14, 14]} style={{ marginTop: 12 }}>
        <KpiTile title="Attendance" value={attendance?.attendancePct} suffix="%" tone="slate" icon={<CheckSquareOutlined />} />
        <KpiTile title="Assessments qualified" value={qualifiedCount} suffix={`/ ${assessmentResults.length}`} tone="slate" icon={<FileTextOutlined />} />
        <KpiTile title="Quizzes completed" value={quizzesCompleted} suffix={`/ ${quizzes.length}`} tone="slate" icon={<ExperimentOutlined />} />
        <KpiTile title="Projects approved" value={projectsApproved} suffix={`/ ${projects.length}`} tone="slate" icon={<ProjectOutlined />} />
        <KpiTile title="Policies pending" value={policiesPending} tone="slate" icon={<SolutionOutlined />} />
        <KpiTile title="Certificates" value={certificates.length} tone="slate" icon={<SafetyCertificateOutlined />} />
        <KpiTile title="Unread notifications" value={notifications.unread} tone="slate" icon={<BellOutlined />} />
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Attendance summary" bordered extra={<a onClick={() => navigate('/learn/attendance')}>View details</a>}>
            {!attendance ? (
              <Empty description="No attendance yet" />
            ) : (
              <List size="small">
                <List.Item>Present: <b>{attendance.present}</b></List.Item>
                <List.Item>Late: <b>{attendance.late}</b></List.Item>
                <List.Item>Partial: <b>{attendance.partial}</b></List.Item>
                <List.Item>Absent: <b>{attendance.absent}</b></List.Item>
                <List.Item>Excused: <b>{attendance.excused}</b></List.Item>
              </List>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Recent notifications" bordered extra={<a onClick={() => navigate('/learn/notifications')}>View all</a>}>
            <List
              size="small"
              dataSource={(notifications.recent || []).slice(0, 6)}
              locale={{ emptyText: 'No notifications' }}
              renderItem={(n) => (
                <List.Item>
                  <Text strong={!n.read}>{n.title}</Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Projects" bordered extra={<a onClick={() => navigate('/learn/projects')}>View details</a>}>
            <Table
              size="small"
              rowKey={(r) => r._id || r.title}
              dataSource={projects}
              pagination={false}
              locale={{ emptyText: 'No project assigned yet' }}
              columns={[
                { title: 'Title', dataIndex: 'title' },
                { title: 'Mentor', dataIndex: 'mentorName' },
                { title: 'Status', dataIndex: 'status', render: (s) => <Tag>{s}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Policies" bordered extra={<a onClick={() => navigate('/learn/policies')}>View details</a>}>
            <Table
              size="small"
              rowKey={(r) => r._id || r.policyTitle}
              dataSource={policies.filter((p) => p.status !== 'acknowledged').slice(0, 6)}
              pagination={false}
              locale={{ emptyText: 'Nothing pending — all acknowledged' }}
              columns={[
                { title: 'Policy', dataIndex: 'title' },
                { title: 'Mandatory', dataIndex: 'mandatory', render: (v) => (v ? <Tag color="red">Mandatory</Tag> : <Tag>Optional</Tag>) },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
