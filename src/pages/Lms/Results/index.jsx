import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Tag, Skeleton, Empty, Typography, Space, Button } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import KpiTile from '../components/KpiTile';

const { Text } = Typography;

// UI-only mock — wire to GET /api/tests/my-results and
// GET /api/tests/:attemptId/breakdown once those exist. Field names
// (testType/status/qualified/warningCount/...) and the breakdown shape
// (correct/incorrect/ungraded) match that reference API 1:1.
const TEST_TYPE_LABELS = { BASIC: 'Basic Test', MAJOR: 'Major Test', MICRO: 'Micro Test', NLP_MICRO: 'NLP Micro Test', NLP_MAJOR: 'NLP Major Test' };
const STATUS_COLOR = { SUBMITTED: 'green', SUSPENDED: 'red', IN_PROGRESS: 'gold' };

const MOCK_ATTEMPTS_BY_TYPE = {
  BASIC: { used: 2, max: 3, remaining: 1, nextEligibleAt: null },
  MAJOR: { used: 1, max: 3, remaining: 2, nextEligibleAt: null },
  MICRO: { used: 3, max: 3, remaining: 0, nextEligibleAt: null },
};

const MOCK_RESULTS = [
  {
    attemptId: 'r1', testType: 'MAJOR', status: 'SUBMITTED', score: 41, totalCount: 50, warningCount: 0,
    startedAt: '2026-08-20T10:00:00Z', submittedAt: '2026-08-20T11:05:00Z', qualified: true,
    breakdown: [
      { topic: 'Components & Props', correct: 8, incorrect: 2, ungraded: 0 },
      { topic: 'Hooks', correct: 6, incorrect: 2, ungraded: 0 },
      { topic: 'Routing', correct: 4, incorrect: 1, ungraded: 0 },
    ],
  },
  {
    attemptId: 'r2', testType: 'BASIC', status: 'SUBMITTED', score: 23, totalCount: 40, warningCount: 1,
    startedAt: '2026-08-10T09:00:00Z', submittedAt: '2026-08-10T09:50:00Z', qualified: false,
    breakdown: [
      { topic: 'Closures', correct: 3, incorrect: 5, ungraded: 0 },
      { topic: 'Async/Await', correct: 4, incorrect: 2, ungraded: 0 },
      { topic: 'Array methods', correct: 6, incorrect: 2, ungraded: 0 },
    ],
  },
  {
    attemptId: 'r3', testType: 'MICRO', status: 'SUSPENDED', score: 5, totalCount: 20, warningCount: 3,
    startedAt: '2026-08-02T14:00:00Z', submittedAt: null, qualified: false,
    breakdown: [{ topic: 'SQL Queries', correct: 1, incorrect: 3, ungraded: 0 }],
  },
];

export default function Results() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [attemptsByType, setAttemptsByType] = useState({});
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setRows(MOCK_RESULTS);
      setAttemptsByType(MOCK_ATTEMPTS_BY_TYPE);
      setLoading(false);
    }, 500);
    return () => clearTimeout(t);
  }, []);

  if (loading) return <Skeleton active paragraph={{ rows: 8 }} style={{ padding: 24 }} />;

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div>
          <h2><LineChartOutlined /> Assessment Results</h2>
          <p>A complete record of your assessment attempts.</p>
        </div>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {['BASIC', 'MAJOR', 'MICRO'].map((type) => {
          const info = attemptsByType[type];
          if (!info) return null;
          return (
            <Col key={type} xs={24} sm={8}>
              <Card size="small">
                <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{TEST_TYPE_LABELS[type]}</Text>
                <div style={{ fontWeight: 600, marginTop: 4 }}>{info.used} of {info.max} attempts used</div>
                {info.remaining === 0 ? (
                  <Text type="danger" style={{ fontSize: 12 }}>No attempts remaining</Text>
                ) : info.nextEligibleAt ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>Next attempt available {new Date(info.nextEligibleAt).toDateString()}</Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>{info.remaining} attempt{info.remaining > 1 ? 's' : ''} available now</Text>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>

      {rows.length === 0 ? (
        <Card><Empty description="You have not completed any assessments yet." /></Card>
      ) : (
        <Table
          rowKey="attemptId"
          dataSource={rows}
          pagination={false}
          expandable={{
            expandedRowKeys: expandedId ? [expandedId] : [],
            onExpand: (expanded, r) => setExpandedId(expanded ? r.attemptId : null),
            rowExpandable: (r) => r.status === 'SUBMITTED' || r.status === 'SUSPENDED',
            expandedRowRender: (r) => (
              <Table
                size="small"
                rowKey="topic"
                dataSource={r.breakdown}
                pagination={false}
                locale={{ emptyText: 'No report available for this attempt.' }}
                columns={[
                  { title: 'Topic', dataIndex: 'topic' },
                  {
                    title: 'Result',
                    render: (_, t) => {
                      const answered = t.correct + t.incorrect;
                      return answered > 0
                        ? `${t.correct}/${answered} correct${t.ungraded > 0 ? ` · ${t.ungraded} unanswered` : ''}`
                        : 'Not answered';
                    },
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'Test', dataIndex: 'testType', render: (v) => TEST_TYPE_LABELS[v] || v },
            { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={STATUS_COLOR[v]}>{v}</Tag> },
            { title: 'Qualified', dataIndex: 'qualified', render: (v) => (v === null ? '—' : <Tag color={v ? 'green' : 'red'}>{v ? 'Qualified' : 'Disqualified'}</Tag>) },
            { title: 'Score', render: (_, r) => (r.status === 'SUBMITTED' ? `${r.score}/${r.totalCount}` : '—') },
            { title: 'Warnings', dataIndex: 'warningCount' },
            { title: 'Started', dataIndex: 'startedAt', render: (v) => new Date(v).toLocaleString() },
          ]}
        />
      )}
      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        Showing sample data — live results will replace this once wired to your attempt history.
      </Text>
    </div>
  );
}
