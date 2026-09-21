import React, { useState } from 'react';
import { Card, Row, Col, Typography, Button, message } from 'antd';
import { LockOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { BasicTest, MajorTestPythonSql, MajorTestNlp, MicroTestSqlDb, MicroTestNlpSerp } from '../TestIntro/variants';

const { Text, Title } = Typography;

// Ported 1:1 from the python-test-platform reference project's own
// frontend/app/dashboard/page.tsx — the candidate's personalized landing
// page ("Welcome, {name}") with the full assessment grid, distinct from both
// the generic LMS "Home" (StudentDashboard, course/class progress) and the
// "Assessment Roadmap" tab (which still routes every card to the shared
// Quizzes area). Used as the "Assessment" tab on all three sides (Student
// /learn, Teacher /teacher, and the Admin console's LMS section via
// ModuleScaffold's embed registry) — an unlocked card renders the matching
// TestIntro variant IN PLACE (same component the Quizzes & Exams nav uses)
// rather than navigating to a route, so it works the same regardless of
// which shell hosts it.
const TESTS = [
  { key: 'basic', Component: BasicTest, eyebrow: 'Foundational Assessment', title: 'Basic Test', description: 'Multiple-choice, output-based, and short programming questions covering core fundamentals.' },
  { key: 'major-python-sql', Component: MajorTestPythonSql, eyebrow: 'Comprehensive Assessment', title: 'Python Programming Foundations & SQL Basics', description: 'In-depth, advanced-level questions administered under full proctoring.' },
  { key: 'micro-sql-db', Component: MicroTestSqlDb, eyebrow: 'Applied Project', title: 'Micro Test — SQL-Backed Keyword Database', description: 'Design and query a SQL-backed keyword database.' },
  { key: 'micro-nlp-serp', Component: MicroTestNlpSerp, eyebrow: 'Applied Project', title: 'Micro Test — NLP on a SERP Dataset', description: 'Given 20 scraped article titles: extract keywords, classify intent, output ranked report.' },
  { key: 'major-nlp', Component: MajorTestNlp, eyebrow: 'Comprehensive Assessment', title: 'NLP Fundamentals & Introduction to LLMs', description: 'Text preprocessing, POS tagging & NER, TF-IDF/YAKE keyword extraction, embeddings, sentiment analysis, and LLM fundamentals.' },
];

const RAW_LOCKED_TITLES = [
  'LLM APIs & Prompt Engineering assessment',
  'Micro Test — Prompt Engineering',
  'ML & Probability Basics for Agent Builders assessment',
  'Train/Test Split & Cross-Validation',
  'Micro Test + Unit Review',
  'AI Agent Architecture & Design Patterns assessment',
  'Micro Test — Tool Builder',
  'SEO Domain Knowledge & Agent Feature Engineering',
  'Micro Test — SEO Content Audit',
  'Agent Productionisation & Capstone Project assessment',
];

const LOCKED_MODULES = [
  ...RAW_LOCKED_TITLES.map((title) => ({ title, eyebrow: title.startsWith('Micro Test') ? 'Micro Test' : 'Assessment' })),
  {
    title: 'Micro Test — ML Pipeline',
    eyebrow: 'Micro Test',
    bullets: [
      'Build and evaluate a keyword ranking probability model',
      'Output: ranked list of 50 keywords by estimated difficulty with SHAP explanation',
    ],
  },
  { title: 'Unit 8: Machine Learning Engineering (Advanced) Assessment', eyebrow: 'Major Assessment' },
  {
    title: 'Micro Test — Deploy to Cloud',
    eyebrow: 'Micro Test',
    bullets: [
      'Deploy the SEO agent on AWS ECS with load balancer; environment secrets from AWS Secrets Manager',
      'Grafana dashboard showing request latency and LLM token usage',
    ],
  },
  { title: 'Unit 10: Cloud Deployment, MLOps & DevOps Assessment', eyebrow: 'Major Assessment' },
  { title: 'Unit 11: AI Research Skills & Staying Current Assessment', eyebrow: 'Major Assessment' },
  { title: 'Unit 12: Product Development & Business of AI Agents Assessment', eyebrow: 'Major Assessment' },
];

export default function AssessmentDashboard() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const [msgApi, contextHolder] = message.useMessage();
  const [activeKey, setActiveKey] = useState(null);

  const firstName = (admin.name || '').trim().split(' ')[0];
  const clickLocked = (title) => msgApi.info(`"${title}" unlocks after completing prior modules.`, 3.5);

  if (activeKey) {
    const active = TESTS.find((t) => t.key === activeKey);
    const ActiveComponent = active.Component;
    return (
      <div className="lms-portal" style={{ padding: 4 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => setActiveKey(null)} style={{ marginBottom: 12 }}>
          Back to Dashboard
        </Button>
        <ActiveComponent />
      </div>
    );
  }

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      {contextHolder}
      <div className="lms-portal-head">
        <div>
          <h2>{firstName ? `Welcome, ${firstName}` : 'Your Assessment Dashboard'}</h2>
          <p>
            {firstName
              ? 'This is your assessment portal. Select an assessment to begin, or review your previous results.'
              : 'Select an assessment to begin, or review your previous results.'}
          </p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        {TESTS.map((t) => (
          <Col key={t.key} xs={24} sm={12} lg={8}>
            <Card hoverable onClick={() => setActiveKey(t.key)} style={{ height: '100%' }}>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t.eyebrow}
              </Text>
              <Title level={5} style={{ marginTop: 8, marginBottom: 8 }}>{t.title}</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>{t.description}</Text>
            </Card>
          </Col>
        ))}

        {LOCKED_MODULES.map((m) => (
          <Col key={m.title} xs={24} sm={12} lg={8}>
            <Card
              onClick={() => clickLocked(m.title)}
              style={{ height: '100%', opacity: 0.6, cursor: 'not-allowed' }}
              bodyStyle={{ height: '100%' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {m.eyebrow}
                </Text>
                <LockOutlined style={{ color: '#94a3b8' }} />
              </div>
              <Title level={5} type="secondary" style={{ marginBottom: 8 }}>{m.title}</Title>
              {m.bullets ? (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {m.bullets.map((b) => (
                    <li key={b} style={{ fontSize: 12, color: '#94a3b8' }}>{b}</li>
                  ))}
                </ul>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>Coming soon</Text>
              )}
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
