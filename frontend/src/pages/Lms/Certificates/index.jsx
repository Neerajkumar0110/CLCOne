import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Checkbox, Space, Empty, Skeleton, message, Typography, Divider, Row, Col, Collapse, Progress,
} from 'antd';
import { TrophyOutlined, SafetyCertificateOutlined, ReloadOutlined, DownloadOutlined, TeamOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '../api';

const { Text, Paragraph, Title } = Typography;
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

function slug(s) {
  return String(s || 'certificate').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Admin/Super Admin/Support/Sales Manager/owner + Teacher — "which batches
// exist, who's in them, who's actually earned a certificate yet" (per-batch
// headcount + roster), reading services/lms/certificatePdf's same
// Issued/Sent gate the student-facing download uses.
function BatchRoster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    lmsApi.certificateRoster().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Roster load failed')).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (!rows.length) return <Empty description="No candidates yet." />;

  return (
    <Collapse
      items={rows.map((b) => ({
        key: b.batch,
        label: (
          <Space>
            <b>{b.batch}</b>
            <Text type="secondary">{b.course}</Text>
            <Tag color={b.completed === b.total ? 'green' : 'blue'}>{b.completed}/{b.total} completed</Tag>
          </Space>
        ),
        children: (
          <Table
            rowKey="email"
            size="small"
            pagination={false}
            dataSource={b.students}
            columns={[
              { title: 'Candidate', dataIndex: 'name' },
              { title: 'Email', dataIndex: 'email' },
              { title: 'Progress', dataIndex: 'progress', width: 140, render: (v) => <Progress percent={v} size="small" /> },
              { title: 'Status', dataIndex: 'status', width: 100 },
              {
                title: 'Certificate',
                width: 170,
                render: (_, s) => (s.certificate
                  ? <Tag color="gold">{s.certificate.certificateId} · {s.certificate.grade}</Tag>
                  : <Tag>Not yet</Tag>),
              },
              {
                title: '',
                width: 100,
                render: (_, s) => (s.certificate ? (
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => lmsApi.downloadCertificatePdf(s.certificate.id, false, slug(`${s.name}-${s.certificate.certificateId}`))}
                  >
                    PDF
                  </Button>
                ) : null),
              },
            ]}
          />
        ),
      }))}
    />
  );
}

// isManagerRole: Admin/Super Admin/Support/Sales Manager/owner aren't a
// trainer on anything, so teacherDashboard()'s "my own courses" list always
// comes back empty for them (same gap fixed earlier for Assignments/
// AssessmentDashboard) — they instead get every course in the system.
function TeacherCertificates({ isManagerRole }) {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [rule, setRule] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ruleForm] = Form.useForm();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm] = Form.useForm();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [d, h] = await Promise.all([
          isManagerRole
            ? request.list({ entity: 'course', options: { items: 500, sortBy: 'title', sortValue: 1 } })
            : lmsApi.teacherDashboard(),
          lmsApi.certHistory(),
        ]);
        const list = isManagerRole
          ? ((d && d.result) || []).map((c) => ({ value: c._id, label: c.title }))
          : ((d && d.result && d.result.courses) || []).map((c) => ({ value: c.id, label: c.title }));
        setCourses(list);
        setHistory((h && h.result) || []);
        if (list[0]) setCourseId(list[0].value);
      } catch (e) { message.error('Load failed'); } finally { setLoading(false); }
    })();
  }, [isManagerRole]);

  const loadRule = useCallback(async (id) => {
    if (!id) return;
    try {
      const res = await lmsApi.certRule(id);
      const r = (res && res.result) || null;
      setRule(r);
      ruleForm.setFieldsValue(r || { minCoursePercent: 100, minAttendancePercent: 0, requireAllAssignments: false, minQuizPercent: 0, autoIssue: true, validMonths: 0, title: 'Certificate of Completion', type: 'Completion' });
    } catch (e) { /* */ }
  }, [ruleForm]);
  useEffect(() => { loadRule(courseId); }, [courseId, loadRule]);

  const saveRule = async () => {
    let v; try { v = await ruleForm.validateFields(); } catch (e) { return; }
    try { await lmsApi.saveCertRule(courseId, v); message.success('Rule saved'); loadRule(courseId); }
    catch (e) { message.error('Save failed'); }
  };
  const runNow = async () => {
    setRunning(true);
    try { const res = await lmsApi.runCertificates(courseId); message.success(res?.message || 'Done'); const h = await lmsApi.certHistory(); setHistory((h && h.result) || []); }
    catch (e) { message.error('Run failed'); } finally { setRunning(false); }
  };
  const issue = async () => {
    let v; try { v = await issueForm.validateFields(); } catch (e) { return; }
    try {
      const res = await lmsApi.issueCertificate({ course: courseId, studentEmail: v.studentEmail, force: v.force });
      message.success(res?.message || 'Done');
      setIssueOpen(false); issueForm.resetFields();
      const h = await lmsApi.certHistory(); setHistory((h && h.result) || []);
    } catch (e) { message.error('Failed'); }
  };

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><TrophyOutlined /> Certificates</h2><p>Set the criteria — the system issues them automatically.</p></div>
        <Select style={{ minWidth: 240 }} value={courseId} onChange={setCourseId} options={courses} placeholder="Course" />
      </div>

      <Card size="small" title={<Space><TeamOutlined /> Batch roster — who's in which batch, who's completed</Space>} style={{ marginBottom: 12 }}>
        <BatchRoster />
      </Card>

      {!courseId ? <Card><Empty description="No courses assigned." /></Card> : (
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={10}>
            <Card size="small" title="Issue criteria">
              <Form form={ruleForm} layout="vertical">
                <Form.Item name="title" label="Certificate title"><Input /></Form.Item>
                <Form.Item name="type" label="Type"><Select options={['Completion', 'Participation', 'Merit', 'Achievement'].map((v) => ({ value: v, label: v }))} /></Form.Item>
                <Space wrap>
                  <Form.Item name="minCoursePercent" label="Min course %"><InputNumber min={0} max={100} /></Form.Item>
                  <Form.Item name="minAttendancePercent" label="Min attendance %"><InputNumber min={0} max={100} /></Form.Item>
                  <Form.Item name="minQuizPercent" label="Min quiz %"><InputNumber min={0} max={100} /></Form.Item>
                  <Form.Item name="validMonths" label="Valid (months, 0=∞)"><InputNumber min={0} /></Form.Item>
                </Space>
                <Space size="large">
                  <Form.Item name="requireAllAssignments" valuePropName="checked" noStyle><Checkbox>All assignments evaluated</Checkbox></Form.Item>
                  <Form.Item name="autoIssue" valuePropName="checked" noStyle><Checkbox>Auto-issue</Checkbox></Form.Item>
                  <Form.Item name="enabled" valuePropName="checked" noStyle initialValue><Checkbox>Enabled</Checkbox></Form.Item>
                </Space>
                <Divider style={{ margin: '12px 0' }} />
                <Space>
                  <Button type="primary" onClick={saveRule}>Save rule</Button>
                  <Button icon={<ReloadOutlined />} loading={running} onClick={runNow}>Re-check all candidates</Button>
                  <Button onClick={() => setIssueOpen(true)}>Issue manually</Button>
                </Space>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card size="small" title="Issued certificates">
              <Table
                rowKey="id"
                size="small"
                dataSource={history}
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: 'None yet' }}
                columns={[
                  { title: 'Candidate', dataIndex: 'student' },
                  { title: 'Course', dataIndex: 'course' },
                  { title: 'ID', dataIndex: 'certificateId' },
                  { title: 'Grade', dataIndex: 'grade', width: 70 },
                  { title: 'Issued', dataIndex: 'issuedOn', render: (v) => (v ? dayjs(v).format('D MMM YY') : '—') },
                  { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={['Issued', 'Sent'].includes(s) ? 'green' : 'default'}>{s}</Tag> },
                  {
                    title: '',
                    width: 90,
                    render: (_, r) => (['Issued', 'Sent'].includes(r.status) ? (
                      <Button size="small" icon={<DownloadOutlined />} onClick={() => lmsApi.downloadCertificatePdf(r.id, false, slug(`${r.student}-${r.certificateId}`))}>PDF</Button>
                    ) : null),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}

      <Modal open={issueOpen} title="Issue certificate manually" onCancel={() => setIssueOpen(false)} onOk={issue} okText="Check & issue" destroyOnClose>
        <Form form={issueForm} layout="vertical" preserve={false}>
          <Form.Item name="studentEmail" label="Candidate email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="force" valuePropName="checked" noStyle><Checkbox>Force (ignore criteria)</Checkbox></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function StudentCertificates() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    lmsApi.myCertificates().then((r) => setRows((r && r.result) || [])).catch(() => message.error('Load failed')).finally(() => setLoading(false));
  }, []);
  if (loading) return <Skeleton active paragraph={{ rows: 5 }} style={{ padding: 24 }} />;
  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head"><div><h2><TrophyOutlined /> My Certificates</h2><p>Your earned certificates.</p></div></div>
      {rows.length === 0 ? <Card><Empty description="No certificates yet — finish a course to earn one." /></Card> : (
        <Row gutter={[16, 16]}>
          {rows.map((c) => (
            <Col xs={24} sm={12} lg={8} key={c.id}>
              <Card>
                <SafetyCertificateOutlined style={{ fontSize: 32, color: '#a16207' }} />
                <Title level={5} style={{ marginTop: 8 }}>{c.title}</Title>
                <Text strong>{c.course}</Text>
                <Paragraph type="secondary" style={{ margin: '6px 0' }}>
                  ID {c.certificateId}<br />Grade {c.grade} · {c.score}%<br />Issued {c.issuedOn ? dayjs(c.issuedOn).format('D MMM YYYY') : '—'}
                </Paragraph>
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => lmsApi.downloadCertificatePdf(c.id, true, slug(`${c.course}-${c.certificateId}`))}
                  >
                    Download
                  </Button>
                  {c.verificationUrl && <Button size="small" href={c.verificationUrl} target="_blank" rel="noopener">Verify</Button>}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}

export default function Certificates() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const isManagerRole = MGR.includes(admin.role);
  if (isManagerRole || LMS_TEACHER_ROLES.includes(admin.role)) return <TeacherCertificates isManagerRole={isManagerRole} />;
  return <StudentCertificates />;
}
