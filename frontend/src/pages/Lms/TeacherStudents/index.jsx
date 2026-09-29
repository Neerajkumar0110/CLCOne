import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Row, Table, Tag, Input, Select, Button, Space, Progress, Empty } from 'antd';
import { TeamOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import lmsApi from '../api';
import KpiTile from '../components/KpiTile';

const STATUS_COLOR = { Active: 'green', 'On Hold': 'gold', Completed: 'blue', Dropped: 'default', Deferred: 'orange' };

function KPI({ label, value, suffix, tone }) {
  return <KpiTile title={label} value={value} suffix={suffix} tone={tone} span={{ xs: 12, sm: 8, md: 6, lg: 6, xxl: 6 }} />;
}

export default function TeacherStudents() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lmsApi.teacherStudents({ batch: batch || undefined, status: status || undefined, q: q || undefined });
      setData((res && res.result) || null);
    } finally {
      setLoading(false);
    }
  }, [batch, status, q]);

  useEffect(() => {
    load();
  }, [load]);

  const batches = (data && data.batches) || [];
  const students = (data && data.students) || [];
  const k = (data && data.kpis) || {};

  const batchOptions = useMemo(
    () => batches.map((b) => ({ value: b.name, label: `${b.name} (${b.studentCount})` })),
    [batches]
  );

  return (
    <div className="lms-portal lms-section-students">
      <div className="lms-portal-head">
        <div>
          <h2><TeamOutlined /> Students</h2>
          <p>Every student across the batches you teach, batch-wise.</p>
        </div>
      </div>

      <Row gutter={[14, 14]} style={{ marginBottom: 14 }}>
        <KPI label="Total students" value={k.totalStudents || 0} tone="blue" />
        <KPI label="My batches" value={k.totalBatches || 0} tone="cyan" />
        <KPI label="Active" value={k.activeStudents || 0} tone="green" />
        <KPI label="In view" value={students.length} tone="slate" />
      </Row>

      {batches.length > 0 && (
        <div className="lms-toolbar" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {batches.map((b) => (
            <Tag.CheckableTag
              key={b.id}
              checked={batch === b.name}
              onChange={(checked) => setBatch(checked ? b.name : '')}
              style={{ padding: '5px 12px', borderRadius: 16, border: '1px solid var(--hub-border, #e5e7eb)' }}
            >
              {b.name} · {b.studentCount}
            </Tag.CheckableTag>
          ))}
        </div>
      )}

      <Space wrap className="lms-toolbar" style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Batch" style={{ width: 220 }} value={batch || undefined}
          onChange={(v) => setBatch(v || '')} options={batchOptions} />
        <Select allowClear placeholder="Status" style={{ width: 150 }} value={status || undefined}
          onChange={(v) => setStatus(v || '')}
          options={['Active', 'On Hold', 'Completed', 'Dropped', 'Deferred'].map((s) => ({ value: s, label: s }))} />
        <Input allowClear placeholder="Search name / email / enrollment ID" prefix={<SearchOutlined />} style={{ width: 260 }}
          value={q} onChange={(e) => setQ(e.target.value)} onPressEnter={load} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
      </Space>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={students}
        pagination={{ pageSize: 25, showSizeChanger: true }}
        scroll={{ x: 1000 }}
        locale={{ emptyText: <Empty description="No students in your batches yet." /> }}
        columns={[
          { title: 'Student', dataIndex: 'name', fixed: 'left', width: 160 },
          { title: 'Email', dataIndex: 'email', width: 210 },
          { title: 'Enrollment ID', dataIndex: 'enrollmentId', width: 120 },
          { title: 'Batch', dataIndex: 'batch', width: 160 },
          { title: 'Course', dataIndex: 'course', width: 160 },
          { title: 'Phone', dataIndex: 'phone', width: 120 },
          { title: 'Progress', dataIndex: 'progress', width: 120, render: (v) => <Progress percent={v || 0} size="small" /> },
          { title: 'Attendance', dataIndex: 'attendancePct', width: 120, render: (v) => <Progress percent={v || 0} size="small" strokeColor="#0e7490" /> },
          { title: 'Enrolled on', dataIndex: 'enrolledOn', width: 110, render: (v) => (v ? new Date(v).toLocaleDateString() : '—') },
          {
            title: 'Status', dataIndex: 'status', fixed: 'right', width: 110,
            render: (v) => <Tag color={STATUS_COLOR[v] || 'default'}>{v}</Tag>,
          },
        ]}
      />
    </div>
  );
}
