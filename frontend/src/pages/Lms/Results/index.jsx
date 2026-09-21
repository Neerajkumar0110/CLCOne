import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Tag, Skeleton, Empty, Typography } from 'antd';
import { LineChartOutlined } from '@ant-design/icons';
import lmsApi from '@/pages/Lms/api';

const { Text } = Typography;

// Wired to GET /api/lms/assessments/my-results and
// GET /api/lms/assessments/:attemptId/breakdown (ported from the
// python-test-platform reference project — see AssessmentRunner/TestIntro).
const TEST_TYPE_LABELS = { BASIC: 'Basic Test', MAJOR: 'Major Test', MICRO: 'Micro Test', NLP_MICRO: 'NLP Micro Test', NLP_MAJOR: 'NLP Major Test' };
const STATUS_COLOR = { SUBMITTED: 'green', SUSPENDED: 'red', IN_PROGRESS: 'gold' };

export default function Results() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [attemptsByType, setAttemptsByType] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [breakdowns, setBreakdowns] = useState({}); // attemptId -> { loading, data }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await lmsApi.myAssessmentResults();
      if (cancelled) return;
      const data = (res && res.result) || {};
      setRows(data.results || []);
      setAttemptsByType(data.attemptsByType || {});
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const loadBreakdown = async (attemptId) => {
    if (breakdowns[attemptId]) return;
    setBreakdowns((prev) => ({ ...prev, [attemptId]: { loading: true, data: [] } }));
    const res = await lmsApi.assessmentBreakdown(attemptId);
    const data = (res && res.result && res.result.breakdown) || [];
    setBreakdowns((prev) => ({ ...prev, [attemptId]: { loading: false, data } }));
  };

  const onExpand = (expanded, r) => {
    setExpandedId(expanded ? r.attemptId : null);
    if (expanded) loadBreakdown(r.attemptId);
  };

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
            onExpand,
            rowExpandable: (r) => r.status === 'SUBMITTED' || r.status === 'SUSPENDED',
            expandedRowRender: (r) => {
              const b = breakdowns[r.attemptId];
              return (
                <Table
                  size="small"
                  rowKey="topic"
                  loading={!b || b.loading}
                  dataSource={(b && b.data) || []}
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
              );
            },
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
    </div>
  );
}
