import React, { useState } from 'react';
import { Card, Button, Typography, Divider } from 'antd';
import { PlayCircleOutlined, FormOutlined } from '@ant-design/icons';
import AssessmentRunner from './AssessmentRunner';

const { Text, Title, Paragraph } = Typography;

/**
 * Landing card for one named test type from the reference nav (Basic Test /
 * Major Test — 2 variants / Micro Test — 2 variants), ported from the
 * python-test-platform reference project. "Start Test" moves into the
 * proctored attempt flow (AssessmentRunner) backed by /api/lms/assessments/*
 * — CRM auth throughout, no separate login.
 */
export default function TestIntro({ icon, eyebrow, title, description, testType }) {
  const [started, setStarted] = useState(false);

  if (started) {
    return <AssessmentRunner testType={testType} onExit={() => setStarted(false)} />;
  }

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      <Card className="lms-test-intro-card" bodyStyle={{ padding: 0 }}>
        <div className="lms-test-intro-hero">
          <div className="lms-test-intro-icon">{icon || <FormOutlined />}</div>
          <div>
            <Text type="secondary" className="lms-test-intro-eyebrow">{eyebrow}</Text>
            <Title level={3} style={{ margin: '4px 0 8px' }}>{title}</Title>
            <Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 560 }}>{description}</Paragraph>
          </div>
        </div>
        <Divider style={{ margin: 0 }} />
        <div className="lms-test-intro-footer">
          <Text type="secondary" style={{ fontSize: 13 }}>
            Proctored — camera, microphone, and screen sharing are required, and the test runs in fullscreen.
          </Text>
          <Button type="primary" size="large" icon={<PlayCircleOutlined />} onClick={() => setStarted(true)}>
            Start Test
          </Button>
        </div>
      </Card>
    </div>
  );
}
