import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Table, Select, Input, DatePicker, InputNumber, Space, Button, Typography, message } from 'antd';
import { AuditOutlined, DownloadOutlined, ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import lmsApi from '@/pages/Lms/api';
import KpiTile from '../components/KpiTile';
import { PageHeading, StatusPill, tablePagination } from '../components/ui';

const { RangePicker } = DatePicker;
const { Text } = Typography;

// Wired to GET /api/lms/assessments/admin/summary, GET .../admin/attempts and
// GET .../admin/attempts/:id/report (ported from the python-test-platform
// reference project).
const TEST_TYPE_LABELS = { BASIC: 'Basic', MAJOR: 'Major', MICRO: 'Micro', NLP_MICRO: 'NLP Micro', NLP_MAJOR: 'NLP Major' };
const STATUS_TONE = { SUBMITTED: 'success', SUSPENDED: 'danger', IN_PROGRESS: 'warning' };
const BATCHES = ['4:00 PM - 5:30 PM', '6:00 PM - 7:30 PM', '8:00 PM - 9:30 PM'];

const DEFAULT_FILTERS = { testType: '', status: '', qualified: '', attemptNumber: '', batch: '', minScore: null, maxScore: null, search: '', range: null, sortBy: 'startedAt', sortOrder: 'desc' };

function toCsvValue(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

export default function AttemptsAdmin() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [applied, setApplied] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({});
  const [openReportId, setOpenReportId] = useState(null);
  const [reports, setReports] = useState({}); // attemptId -> { loading, breakdown }

  const query = useMemo(() => {
    const q = {
      testType: applied.testType || undefined,
      status: applied.status || undefined,
      qualified: applied.qualified || undefined,
      attemptNumber: applied.attemptNumber || undefined,
      batch: applied.batch || undefined,
      minScore: applied.minScore ?? undefined,
      maxScore: applied.maxScore ?? undefined,
      search: applied.search || undefined,
      sortBy: applied.sortBy,
      sortOrder: applied.sortOrder,
      page,
      pageSize,
    };
    if (applied.range && applied.range[0] && applied.range[1]) {
      q.startDate = applied.range[0].startOf('day').toISOString();
      q.endDate = applied.range[1].endOf('day').toISOString();
    }
    return q;
  }, [applied, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const res = await lmsApi.adminAssessmentAttempts(query);
      if (cancelled) return;
      const data = (res && res.result) || {};
      setRows(data.results || []);
      setTotal((data.pagination && data.pagination.total) || 0);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [query]);

  useEffect(() => {
    (async () => {
      const res = await lmsApi.adminAssessmentSummary();
      setSummary((res && res.result) || {});
    })();
  }, []);

  const loadReport = async (attemptId) => {
    if (reports[attemptId]) return;
    setReports((prev) => ({ ...prev, [attemptId]: { loading: true, breakdown: [] } }));
    const res = await lmsApi.adminAssessmentReport(attemptId);
    const breakdown = (res && res.result && res.result.breakdown) || [];
    setReports((prev) => ({ ...prev, [attemptId]: { loading: false, breakdown } }));
  };

  const applyFilters = () => { setPage(1); setApplied(filters); };
  const resetFilters = () => { setFilters(DEFAULT_FILTERS); setApplied(DEFAULT_FILTERS); setPage(1); };

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Test Type', 'Status', 'Score', 'Total', 'Qualified', 'Warnings', 'Started At', 'Submitted At'];
    const lines = [header.map(toCsvValue).join(',')];
    rows.forEach((a) => {
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
    const b = reports[a.attemptId];
    const scoreLine = a.status === 'SUBMITTED' ? `Score: ${a.score}/${a.totalCount}` : `Status: ${a.status}`;
    const topicLines = ((b && b.breakdown) || []).map((t) => {
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
        actions={<Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>}
      />

      <Row gutter={[14, 14]}>
        <KpiTile title="Total Attempts" value={summary.totalAttempts ?? 0} tone="blue" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Today" value={summary.attemptsToday ?? 0} tone="cyan" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="This Week" value={summary.attemptsThisWeek ?? 0} tone="purple" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Avg Score" value={summary.averageScorePercent ?? 0} suffix="%" tone="green" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
        <KpiTile title="Qualification Rate" value={summary.qualificationRate ?? 0} suffix="%" tone="amber" span={{ xs: 12, sm: 8, lg: 4, xxl: 4 }} />
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
        dataSource={rows}
        loading={loading}
        size="middle"
        tableLayout="fixed"
        pagination={{ ...tablePagination({ pageSize }), current: page, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        locale={{ emptyText: 'No attempts match these filters.' }}
        expandable={{
          expandedRowKeys: openReportId ? [openReportId] : [],
          onExpand: (expanded, r) => { setOpenReportId(expanded ? r.attemptId : null); if (expanded) loadReport(r.attemptId); },
          expandedRowRender: (a) => {
            const b = reports[a.attemptId];
            return (
              <div>
                <Space style={{ marginBottom: 8 }}>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => exportCsv()}>Download Report</Button>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copyReportSummary(a)}>Copy Summary</Button>
                </Space>
                <Table
                  size="small"
                  rowKey="topic"
                  loading={!b || b.loading}
                  dataSource={(b && b.breakdown) || []}
                  pagination={b && b.breakdown && b.breakdown.length > 10 ? tablePagination({ pageSize: 10, size: 'small' }) : false}
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
            );
          },
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
    </div>
  );
}
