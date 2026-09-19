import React, { useMemo, useState } from 'react';
import { Card, Row, Table, Select, Input, DatePicker, InputNumber, Space, Button, Typography, message } from 'antd';
import { AuditOutlined, DownloadOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import KpiTile from '../components/KpiTile';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';

const { RangePicker } = DatePicker;
const { Text } = Typography;

// UI-only mock — wire to GET /api/admin/summary, GET /api/admin/attempts and
// GET /api/admin/attempts/:id/report once those exist. Field names
// (studentName/testType/qualified/warningCount/...) and the breakdown shape
// (correct/incorrect/ungraded) match that reference API 1:1.
const TEST_TYPE_LABELS = { BASIC: 'Basic', MAJOR: 'Major', MICRO: 'Micro', NLP_MICRO: 'NLP Micro', NLP_MAJOR: 'NLP Major' };
const STATUS_TONE = { SUBMITTED: 'success', SUSPENDED: 'danger', IN_PROGRESS: 'warning' };
const BATCHES = ['4:00 PM - 5:30 PM', '6:00 PM - 7:30 PM', '8:00 PM - 9:30 PM'];

const MOCK_ATTEMPTS = [
  { attemptId: 'a1', studentName: 'Aarav Sharma', studentEmail: 'aarav@example.com', testType: 'MAJOR', status: 'SUBMITTED', score: 41, totalCount: 50, warningCount: 0, startedAt: '2026-09-15T10:02:00Z', submittedAt: '2026-09-15T11:10:00Z', qualified: true, attemptNumber: 1, studentBatch: '4:00 PM - 5:30 PM',
    breakdown: [{ topic: 'Components & Props', correct: 8, incorrect: 2, ungraded: 0 }, { topic: 'Hooks', correct: 6, incorrect: 2, ungraded: 0 }] },
  { attemptId: 'a2', studentName: 'Priya Nair', studentEmail: 'priya@example.com', testType: 'MAJOR', status: 'SUBMITTED', score: 32, totalCount: 50, warningCount: 1, startedAt: '2026-09-15T09:30:00Z', submittedAt: '2026-09-15T10:35:00Z', qualified: true, attemptNumber: 1, studentBatch: '4:00 PM - 5:30 PM',
    breakdown: [{ topic: 'Components & Props', correct: 6, incorrect: 4, ungraded: 0 }, { topic: 'Hooks', correct: 4, incorrect: 4, ungraded: 0 }] },
  { attemptId: 'a3', studentName: 'Rohit Verma', studentEmail: 'rohit@example.com', testType: 'BASIC', status: 'SUSPENDED', score: 12, totalCount: 40, warningCount: 3, startedAt: '2026-09-14T18:05:00Z', submittedAt: null, qualified: false, attemptNumber: 1, studentBatch: '6:00 PM - 7:30 PM',
    breakdown: [{ topic: 'Closures', correct: 2, incorrect: 6, ungraded: 0 }, { topic: 'Async/Await', correct: 2, incorrect: 4, ungraded: 0 }] },
  { attemptId: 'a4', studentName: 'Sneha Iyer', studentEmail: 'sneha@example.com', testType: 'BASIC', status: 'SUBMITTED', score: 28, totalCount: 40, warningCount: 0, startedAt: '2026-09-13T20:00:00Z', submittedAt: '2026-09-13T20:55:00Z', qualified: true, attemptNumber: 2, studentBatch: '8:00 PM - 9:30 PM',
    breakdown: [{ topic: 'Closures', correct: 6, incorrect: 2, ungraded: 0 }, { topic: 'Async/Await', correct: 4, incorrect: 2, ungraded: 0 }] },
  { attemptId: 'a5', studentName: 'Karan Mehta', studentEmail: 'karan@example.com', testType: 'MICRO', status: 'IN_PROGRESS', score: null, totalCount: null, warningCount: 0, startedAt: '2026-09-16T08:00:00Z', submittedAt: null, qualified: null, attemptNumber: 1, studentBatch: '4:00 PM - 5:30 PM', breakdown: [] },
];

const DEFAULT_FILTERS = { testType: '', status: '', qualified: '', attemptNumber: '', batch: '', minScore: null, maxScore: null, search: '', range: null, sortBy: 'startedAt', sortOrder: 'desc' };

function toCsvValue(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export default function AttemptsAdmin() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [applied, setApplied] = useState(DEFAULT_FILTERS);
  const [openReportId, setOpenReportId] = useState(null);

  const filtered = useMemo(() => {
    let rows = MOCK_ATTEMPTS.filter((a) => {
      if (applied.testType && a.testType !== applied.testType) return false;
      if (applied.status && a.status !== applied.status) return false;
      if (applied.qualified && String(a.qualified) !== applied.qualified) return false;
      if (applied.attemptNumber && String(a.attemptNumber) !== applied.attemptNumber) return false;
      if (applied.batch && a.studentBatch !== applied.batch) return false;
      if (applied.minScore != null && (a.score == null || a.score < applied.minScore)) return false;
      if (applied.maxScore != null && (a.score == null || a.score > applied.maxScore)) return false;
      if (applied.search) {
        const q = applied.search.toLowerCase();
        if (!a.studentName.toLowerCase().includes(q) && !a.studentEmail.toLowerCase().includes(q)) return false;
      }
      if (applied.range && applied.range[0] && applied.range[1]) {
        const d = new Date(a.startedAt).getTime();
        if (d < applied.range[0].startOf('day').valueOf() || d > applied.range[1].endOf('day').valueOf()) return false;
      }
      return true;
    });
    const dir = applied.sortOrder === 'asc' ? 1 : -1;
    rows = [...rows].sort((x, y) => {
      if (applied.sortBy === 'score') return ((x.score ?? -1) - (y.score ?? -1)) * dir;
      if (applied.sortBy === 'submittedAt') return (new Date(x.submittedAt || 0) - new Date(y.submittedAt || 0)) * dir;
      return (new Date(x.startedAt) - new Date(y.startedAt)) * dir;
    });
    return rows;
  }, [applied]);

  const summary = useMemo(() => {
    const total = MOCK_ATTEMPTS.length;
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const submitted = MOCK_ATTEMPTS.filter((a) => a.status === 'SUBMITTED');
    const avg = submitted.length ? Math.round(submitted.reduce((s, a) => s + (a.score / a.totalCount) * 100, 0) / submitted.length) : 0;
    const qualifiedCount = MOCK_ATTEMPTS.filter((a) => a.qualified === true).length;
    const topicWrong = {};
    MOCK_ATTEMPTS.forEach((a) => (a.breakdown || []).forEach((t) => { topicWrong[t.topic] = (topicWrong[t.topic] || 0) + t.incorrect; }));
    const toughest = Object.entries(topicWrong).sort((x, y) => y[1] - x[1])[0];
    return {
      totalAttempts: total,
      attemptsToday: MOCK_ATTEMPTS.filter((a) => a.startedAt.slice(0, 10) === today).length,
      attemptsThisWeek: MOCK_ATTEMPTS.filter((a) => new Date(a.startedAt).getTime() >= weekAgo).length,
      averageScorePercent: avg,
      qualificationRate: submitted.length ? Math.round((qualifiedCount / submitted.length) * 100) : 0,
      mostStruggledTopic: toughest ? { topic: toughest[0], wrongCount: toughest[1] } : null,
    };
  }, []);

  const applyFilters = () => setApplied(filters);
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setApplied(DEFAULT_FILTERS); };

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Test Type', 'Status', 'Score', 'Total', 'Qualified', 'Warnings', 'Started At', 'Submitted At'];
    const lines = [header.map(toCsvValue).join(',')];
    filtered.forEach((a) => {
      lines.push([
        toCsvValue(a.studentName), toCsvValue(a.studentEmail), toCsvValue(a.testType), toCsvValue(a.status),
        toCsvValue(a.score), toCsvValue(a.totalCount), toCsvValue(a.qualified === null ? '' : a.qualified ? 'Yes' : 'No'),
        toCsvValue(a.warningCount), toCsvValue(new Date(a.startedAt).toLocaleString()),
        toCsvValue(a.submittedAt ? new Date(a.submittedAt).toLocaleString() : ''),
      ].join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `admin-attempts-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const copyReportSummary = (a) => {
    const scoreLine = a.status === 'SUBMITTED' ? `Score: ${a.score}/${a.totalCount}` : `Status: ${a.status}`;
    const topicLines = (a.breakdown || []).map((t) => {
      const answered = t.correct + t.incorrect;
      return `- ${t.topic}: ${answered > 0 ? `${t.correct}/${answered} correct` : 'Not answered'}`;
    }).join('\n');
    const text = `${a.studentName} (${a.studentEmail})\n${TEST_TYPE_LABELS[a.testType] || a.testType} Test — ${scoreLine}\n\nTopic Breakdown:\n${topicLines}`;
    navigator.clipboard?.writeText(text).then(() => message.success('Copied to clipboard')).catch(() => {});
  };

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <PageHeading
        icon={<AuditOutlined />}
        title="Test Attempts"
        description="Review every assessment attempt across all candidates, with a topic-wise breakdown for each."
        actions={<Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>}
      />

      <Row gutter={[14, 14]}>
        <KpiTile title="Total Attempts" value={summary.totalAttempts} tone="blue" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Today" value={summary.attemptsToday} tone="cyan" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="This Week" value={summary.attemptsThisWeek} tone="purple" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Avg Score" value={summary.averageScorePercent} suffix="%" tone="green" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Qualification Rate" value={summary.qualificationRate} suffix="%" tone="amber" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Toughest Topic" value={summary.mostStruggledTopic ? summary.mostStruggledTopic.topic : '—'} tone="slate" span={{ xs: 24, sm: 8, lg: 4, xxl: 4 }} />
      </Row>

      <Card size="small" className="lms-toolbar" style={{ marginTop: 12, marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 10 }}>
          Filters
        </Text>
        <Space wrap size="middle">
          <Select placeholder="All Test Types" style={{ width: 150 }} allowClear value={filters.testType || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, testType: v || '' }))}
            options={Object.entries(TEST_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          <Select placeholder="All Statuses" style={{ width: 150 }} allowClear value={filters.status || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, status: v || '' }))}
            options={[{ value: 'SUBMITTED', label: 'Submitted' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'IN_PROGRESS', label: 'In Progress' }]} />
          <Select placeholder="Qualified: Any" style={{ width: 150 }} allowClear value={filters.qualified || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, qualified: v || '' }))}
            options={[{ value: 'true', label: 'Qualified' }, { value: 'false', label: 'Disqualified' }]} />
          <Select placeholder="Attempt: Any" style={{ width: 140 }} allowClear value={filters.attemptNumber || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, attemptNumber: v || '' }))}
            options={[{ value: '1', label: '1st Attempt' }, { value: '2', label: '2nd Attempt' }, { value: '3', label: '3rd Attempt' }]} />
          <Select placeholder="All Batches" style={{ width: 190 }} allowClear value={filters.batch || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, batch: v || '' }))}
            options={BATCHES.map((b) => ({ value: b, label: b }))} />
          <InputNumber placeholder="Min score" value={filters.minScore} onChange={(v) => setFilters((f) => ({ ...f, minScore: v }))} />
          <InputNumber placeholder="Max score" value={filters.maxScore} onChange={(v) => setFilters((f) => ({ ...f, maxScore: v }))} />
          <Input placeholder="Search name or email" style={{ width: 200 }} value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
          <RangePicker value={filters.range} onChange={(v) => setFilters((f) => ({ ...f, range: v }))} />
          <Select style={{ width: 160 }} value={filters.sortBy} onChange={(v) => setFilters((f) => ({ ...f, sortBy: v }))}
            options={[{ value: 'startedAt', label: 'Sort: Start Date' }, { value: 'submittedAt', label: 'Sort: Submit Date' }, { value: 'score', label: 'Sort: Score' }]} />
          <Select style={{ width: 130 }} value={filters.sortOrder} onChange={(v) => setFilters((f) => ({ ...f, sortOrder: v }))}
            options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} />
        </Space>
        <Space style={{ marginTop: 10 }}>
          <Button type="primary" onClick={applyFilters}>Apply Filters</Button>
          <Button icon={<ReloadOutlined />} onClick={resetFilters}>Reset</Button>
        </Space>
      </Card>

      <Table
        rowKey="attemptId"
        dataSource={filtered}
        size="middle"
        tableLayout="fixed"
        pagination={tablePagination({ pageSize: 10 })}
        locale={{ emptyText: 'No attempts match these filters.' }}
        expandable={{
          expandedRowKeys: openReportId ? [openReportId] : [],
          onExpand: (expanded, r) => setOpenReportId(expanded ? r.attemptId : null),
          expandedRowRender: (a) => (
            <div>
              <Space style={{ marginBottom: 8 }}>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => exportCsv()}>Download Report</Button>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copyReportSummary(a)}>Copy Summary</Button>
              </Space>
              <Table
                size="small"
                rowKey="topic"
                dataSource={a.breakdown}
                pagination={a.breakdown.length > 10 ? tablePagination({ pageSize: 10, size: 'small' }) : false}
                locale={{ emptyText: 'No report available.' }}
                columns={[
                  { title: 'Topic', dataIndex: 'topic' },
                  {
                    title: 'Result',
                    render: (_, t) => {
                      const answered = t.correct + t.incorrect;
                      return answered > 0 ? `${t.correct}/${answered} correct` : 'Not answered';
                    },
                  },
                  { title: 'Ungraded', dataIndex: 'ungraded', width: 100 },
                ]}
              />
            </div>
          ),
        }}
        columns={[
          {
            title: 'Candidate',
            dataIndex: 'studentName',
            width: '21%',
            ellipsis: true,
            render: (name, a) => (
              <div>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                <Text type="secondary" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{a.studentEmail}</Text>
              </div>
            ),
          },
          { title: 'Test', dataIndex: 'testType', width: '9%', render: (v) => <StatusPill tone="info">{TEST_TYPE_LABELS[v] || v}</StatusPill> },
          { title: 'Attempt', dataIndex: 'attemptNumber', width: '7%', align: 'center', render: (v) => (v ? `${v}/3` : '—') },
          { title: 'Batch', dataIndex: 'studentBatch', width: '14%', ellipsis: true },
          { title: 'Status', dataIndex: 'status', width: '11%', render: (v) => <StatusPill tone={STATUS_TONE[v]}>{v}</StatusPill> },
          {
            title: 'Qualified',
            dataIndex: 'qualified',
            width: '11%',
            render: (v) => (v === null ? <Text type="secondary">—</Text> : <StatusPill tone={v ? 'success' : 'danger'}>{v ? 'Qualified' : 'Disqualified'}</StatusPill>),
          },
          { title: 'Score', width: '8%', align: 'right', render: (_, a) => (a.status === 'SUBMITTED' ? `${a.score}/${a.totalCount}` : <Text type="secondary">—</Text>) },
          {
            title: 'Warnings',
            dataIndex: 'warningCount',
            width: '8%',
            align: 'center',
            render: (v) => (v > 0 ? <StatusPill tone="warning">{v}</StatusPill> : <Text type="secondary">0</Text>),
          },
          {
            title: 'Started',
            dataIndex: 'startedAt',
            width: '11%',
            render: (v) => new Date(v).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          },
        ]}
      />
      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Showing sample data — live attempts will replace this once wired to the backend.
      </Text>
    </div>
  );
}
