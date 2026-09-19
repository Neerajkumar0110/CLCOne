import React from 'react';
import { Card, Button, Typography, Divider } from 'antd';
import { PlayCircleOutlined, FormOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';

const { Text, Title, Paragraph } = Typography;

/**
 * UI-only landing card for one named test type from the reference nav
 * (Basic Test / Major Test — 2 variants / Micro Test — 2 variants). That
 * platform runs these against its own Python backend and JWT auth — there's
 * no equivalent content here yet, so "Start" opens our real, backend-wired
 * Quizzes & Exams area instead of a dead end.
 */
export default function TestIntro({ icon, eyebrow, title, description }) {
  const navigate = useNavigate();
  const admin = useSelector(selectCurrentAdmin) || {};
  const isTeacher = LMS_TEACHER_ROLES.includes(admin.role);
  const base = isTeacher ? '/teacher' : '/learn';

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
            This test type isn't wired to its own attempt flow yet — it opens the shared Quizzes &amp; Exams area.
          </Text>
          <Button type="primary" size="large" icon={<PlayCircleOutlined />} onClick={() => navigate(`${base}/quizzes`)}>
            Go to Quizzes &amp; Exams
          </Button>
        </div>
      </Card>
    </div>
  );
}
