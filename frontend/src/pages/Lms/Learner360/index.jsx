import React, { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Button, Select, Space, Empty, Skeleton, message, Progress } from 'antd';
import { ProfileOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import { request } from '@/request';
import lmsApi from '../api';

const STATE_COLOR = { Eligible: 'green', 'Not Yet Eligible': 'gold', 'Action Required': 'red' };

// Learner 360 report (spec §16) — attendance + curriculum + assignments +
// quizzes + surprise tests + policy acknowledgements + project + eligibility
// + certificate, one row per student, built on top of the eligibility
// engine (Phase 2). Management/teacher only.
export default function Learner360() {
  const [courses, setCourses] = useState([]);
  const [courseId, setCourseId] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    request.list({ entity: 'course', options: { items: 300 } }).then((c) => {
      const list = ((c && c.result) || []).map((x) => ({ value: x._id || x.id, label: x.title }));
      setCourses(list);
      if (list[0]) setCourseId(list[0].value);
    }).catch(() => message.error('Could not load courses')).finally(() => setLoading(false));
  }, []);

  const load = useCallback(async () => {
    if (!courseId) return;
    setRefreshing(true);
    try {
      const res = await lmsApi.learner360(courseId);
      setRows((res && res.result && res.result.rows) || []);
    } catch (e) { message.error('Report failed'); } finally { setRefreshing(false); }
  }, [courseId]);
  useEffect(() => { load(); }, [load]);

  const pctCol = (title, key) => ({
    title, dataIndex: key, width: 110,
    render: (v) => (v == null ? <Tag>n/a</Tag> : <Progress percent={v} size="small" />),
  });

  if (loading) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><ProfileOutlined /> Learner 360 Report</h2><p>Attendance, curriculum, assessments, project, policies and eligibility — one row per student.</p></div>
        <Space>
          <Select style={{ minWidth: 220 }} value={courseId} onChange={setCourseId} options={courses} placeholder="Course" />
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={load}>Refresh</Button>
          <Button icon={<DownloadOutlined />} onClick={() => lmsApi.learner360Export(courseId, 'csv')}>CSV</Button>
          <Button icon={<DownloadOutlined />} onClick={() => lmsApi.learner360Export(courseId, 'xlsx')}>Excel</Button>
        </Space>
      </div>

      {rows.length === 0 ? <Card><Empty description="No enrolled students yet." /></Card> : (
        <Table
          rowKey="email" size="small" dataSource={rows} pagination={{ pageSize: 15 }} scroll={{ x: 1400 }}
          columns={[
            { title: 'Student', dataIndex: 'student', fixed: 'left', width: 150 },
            { title: 'Email', dataIndex: 'email', width: 190 },
            { title: 'Batch', dataIndex: 'batch', width: 110 },
            { title: 'Enrollment', dataIndex: 'enrollmentStatus', width: 100 },
            pctCol('Attendance', 'attendancePct'),
            pctCol('Curriculum', 'curriculumPct'),
            pctCol('Assignments', 'assignmentPct'),
            pctCol('Quiz', 'quizPct'),
            pctCol('Surprise Test', 'surpriseTestPct'),
            pctCol('Acknowledgements', 'acknowledgementPct'),
            { title: 'Project', dataIndex: 'projectStatus', width: 120 },
            { title: 'Eligibility', dataIndex: 'eligibilityState', fixed: 'right', width: 130, render: (v, r) => <Tag color={STATE_COLOR[v]}>{v} ({r.eligibilityScore}%)</Tag> },
            { title: 'Certificate', dataIndex: 'certificateId', width: 130, render: (v) => (v ? <Tag color="green">{v}</Tag> : '—') },
          ]}
          expandable={{
            rowExpandable: (r) => !!r.missing,
            expandedRowRender: (r) => <span>Missing for eligibility: {r.missing}</span>,
          }}
        />
      )}
    </div>
  );
}
