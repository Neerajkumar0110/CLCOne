import React, { useCallback, useEffect, useState } from 'react';
import { Card, Row, Col, Tag, Button, Skeleton, Typography, Space } from 'antd';
import { HeartOutlined, ReloadOutlined, CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import lmsApi from '../api';

const { Text } = Typography;

function StatusDot({ ok }) {
  return ok ? <CheckCircleFilled style={{ color: '#52c41a', fontSize: 20 }} /> : <CloseCircleFilled style={{ color: '#ff4d4f', fontSize: 20 }} />;
}

function Tile({ title, ok, detail }) {
  return (
    <Col xs={24} sm={12} lg={8}>
      <Card size="small">
        <Space align="start">
          <StatusDot ok={ok} />
          <div>
            <Text strong>{title}</Text>
            <div><Text type="secondary" style={{ fontSize: 12 }}>{detail}</Text></div>
          </div>
        </Space>
      </Card>
    </Col>
  );
}

// Admin-only view over spec §18 (health checks) + §2's "separate admin
// availability... monitoring" glitch-prevention item — one screen to see
// whether the DB, mailer, meeting provider and background jobs are alive,
// instead of finding out from a learner complaint.
export default function SystemHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    lmsApi.systemHealth().then((r) => setData((r && r.result) || null)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <Skeleton active paragraph={{ rows: 6 }} style={{ padding: 24 }} />;
  const jobs = (data && data.jobs) || {};

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <div className="lms-portal-head">
        <div><h2><HeartOutlined /> System Health</h2><p>Database, mail, meeting provider and background jobs — checked live.</p></div>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
      </div>
      {data && (
        <>
          <Row gutter={[12, 12]}>
            <Tile title="Database" ok={data.database.ok} detail={data.database.state} />
            <Tile title="Email (mailer)" ok={data.mailer.ok} detail={data.mailer.ok ? 'Configured' : 'GMAIL_USER / GMAIL_APP_PASSWORD not set'} />
            <Tile title="Meeting provider" ok={data.meetingProvider.live} detail={`${data.meetingProvider.provider}${data.meetingProvider.live ? '' : ' — falling back to the offline stand-in room'}`} />
            <Tile title="Live-class job" ok={jobs.liveTick && jobs.liveTick.ok} detail={jobs.liveTick && jobs.liveTick.lastRun ? `Last ran ${dayjs(jobs.liveTick.lastRun).format('HH:mm:ss')}` : jobs.liveTick?.note || 'unknown'} />
            <Tile title="Policy reminder job" ok={jobs.policyReminderTick && jobs.policyReminderTick.ok} detail={jobs.policyReminderTick && jobs.policyReminderTick.lastRun ? `Last ran ${dayjs(jobs.policyReminderTick.lastRun).format('D MMM HH:mm')}` : jobs.policyReminderTick?.note || 'unknown'} />
            <Tile title="Moodle sync job" ok={jobs.syncTick && jobs.syncTick.ok} detail={jobs.syncTick && jobs.syncTick.lastRun ? `Last ran ${dayjs(jobs.syncTick.lastRun).format('HH:mm:ss')}` : jobs.syncTick?.note || 'unknown'} />
          </Row>
          <Card size="small" style={{ marginTop: 12 }}>
            <Text type="secondary">Audit log activity (24h): <Tag>{data.auditActivity24h}</Tag> · Checked {dayjs(data.checkedAt).format('D MMM, HH:mm:ss')}</Text>
          </Card>
        </>
      )}
    </div>
  );
}
