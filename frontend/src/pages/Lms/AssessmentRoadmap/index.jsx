import React, { useState } from 'react';
import { Card, Row, Col, Typography, message } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Text, Title } = Typography;

// Mirrors the reference project's candidate dashboard: a sequenced grid of
// assessments, some unlocked (clickable) and some locked (grey, click shows
// why). Data shape (eyebrow/title/description/locked/bullets) matches that
// source 1:1 — wire `unlockedAfter`-style gating to real progress once the
// backend tracks module completion.
const ASSESSMENTS = [
  { key: 'basic', eyebrow: 'Foundational Assessment', title: 'Basic Test', description: 'Multiple-choice, output-based, and short programming questions covering core fundamentals.', locked: false },
  { key: 'major', eyebrow: 'Comprehensive Assessment', title: 'Python Programming Foundations & SQL Basics', description: 'In-depth, advanced-level questions administered under full proctoring.', locked: false },
  { key: 'micro', eyebrow: 'Applied Project', title: 'Micro Test — SQL-Backed Keyword Database', description: 'Design and query a SQL-backed keyword database.', locked: false },
  { key: 'nlp-micro', eyebrow: 'Applied Project', title: 'Micro Test — NLP on a SERP Dataset', description: 'Given 20 scraped article titles: extract keywords, classify intent, output ranked report.', locked: false },
  { key: 'nlp-major', eyebrow: 'Comprehensive Assessment', title: 'NLP Fundamentals & Introduction to LLMs', description: 'Text preprocessing, POS tagging & NER, TF-IDF/YAKE keyword extraction, embeddings, sentiment analysis, and LLM fundamentals.', locked: false },
];

const LOCKED_MODULES = [
  { title: 'LLM APIs & Prompt Engineering assessment', eyebrow: 'Assessment' },
  { title: 'Micro Test — Prompt Engineering', eyebrow: 'Micro Test' },
  { title: 'ML & Probability Basics for Agent Builders assessment', eyebrow: 'Assessment' },
  {
    title: 'Micro Test — ML Pipeline',
    eyebrow: 'Micro Test',
    bullets: [
      'Build and evaluate a keyword ranking probability model',
      'Output: ranked list of 50 keywords by estimated difficulty with SHAP explanation',
    ],
  },
  { title: 'AI Agent Architecture & Design Patterns assessment', eyebrow: 'Assessment' },
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
];

export default function AssessmentRoadmap() {
  const navigate = useNavigate();
  const [msgApi, contextHolder] = message.useMessage();

  const openUnlocked = () => navigate('/learn/quizzes');
  const clickLocked = (title) => msgApi.info(`"${title}" unlocks after completing prior modules.`, 3.5);

  return (
    <div className="lms-portal" style={{ padding: 4 }}>
      {contextHolder}
      <div className="lms-portal-head">
        <div>
          <h2>Your Assessment Roadmap</h2>
          <p>Select an assessment to begin, or review your previous results.</p>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        {ASSESSMENTS.map((t) => (
          <Col key={t.key} xs={24} sm={12} lg={8}>
            <Card hoverable onClick={openUnlocked} style={{ height: '100%' }}>
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
