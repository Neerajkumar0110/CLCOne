import React, { useState } from 'react';
import { Button, message } from 'antd';
import {
  LockOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ClockCircleOutlined,
  AimOutlined,
  FileTextOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  ClusterOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { BasicTest, MajorTestPythonSql, MajorTestNlp, MicroTestSqlDb, MicroTestNlpSerp } from '../TestIntro/variants';

// Colorful card-grid redesign of the candidate assessment landing page
// ("Welcome, {name}"), matching the requested reference mockup 1:1 in style
// (colored icon badges, tinted cards, duration/lock footer row, circular
// arrow buttons, "Keep going!" header widget). Functionally unchanged from
// the previous plain version: same 5 unlocked tests (each opens its
// TestIntro variant in place) + the same locked-modules list, still used as
// the "Assessment" tab on all three sides (Student /learn, Teacher /teacher,
// Admin console via ModuleScaffold). Colors/icons cycle through the dataviz
// skill's validated 8-hue categorical palette (references/palette.md) rather
// than arbitrary hex values.
const PALETTE = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
];
const ICONS = [FileTextOutlined, CodeOutlined, DatabaseOutlined, ExperimentOutlined, ApiOutlined, ThunderboltOutlined, ClusterOutlined, RocketOutlined];

const TESTS = [
  { key: 'basic', path: 'tests/basic', Component: BasicTest, eyebrow: 'Foundational Assessment', title: 'Basic Test', description: 'Multiple-choice, output-based, and short programming questions covering core fundamentals.', duration: '~60 mins' },
  { key: 'major-python-sql', path: 'tests/major/python-sql', Component: MajorTestPythonSql, eyebrow: 'Comprehensive Assessment', title: 'Python Programming Foundations & SQL Basics', description: 'In-depth, advanced-level questions administered under full proctoring.', duration: '~90 mins' },
  { key: 'micro-sql-db', path: 'tests/micro/sql-db', Component: MicroTestSqlDb, eyebrow: 'Applied Project', title: 'Micro Test — SQL-Backed Keyword Database', description: 'Design and query a SQL-backed keyword database.', duration: '~45 mins' },
  { key: 'micro-nlp-serp', path: 'tests/micro/nlp-serp', Component: MicroTestNlpSerp, eyebrow: 'Applied Project', title: 'Micro Test — NLP on a SERP Dataset', description: 'Given 20 scraped article titles: extract keywords, classify intent, output ranked report.', duration: '~60 mins' },
  { key: 'major-nlp', path: 'tests/major/nlp', Component: MajorTestNlp, eyebrow: 'Comprehensive Assessment', title: 'NLP Fundamentals & Introduction to LLMs', description: 'Text preprocessing, POS tagging & NER, TF-IDF/YAKE keyword extraction, embeddings, sentiment analysis, and LLM fundamentals.', duration: '~90 mins' },
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

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function tint(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function AssessmentDashboard() {
  const admin = useSelector(selectCurrentAdmin) || {};
  const [msgApi, contextHolder] = message.useMessage();
  const [activeKey, setActiveKey] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  // On the Teacher/Student sidebar (LmsPanelApp), each test already has its
  // own real route under the sidebar's "Quizzes & Exams" group — navigate
  // there so the sidebar highlights it and the URL/back button work
  // normally. Inside the Admin console's ModuleScaffold embed there is no
  // such route, so fall back to rendering the test in place.
  const base = location.pathname.startsWith('/teacher') ? '/teacher' : location.pathname.startsWith('/learn') ? '/learn' : null;

  const firstName = (admin.name || '').trim().split(' ')[0];
  const clickLocked = (title) => msgApi.info(`"${title}" unlocks after completing prior modules.`, 3.5);
  const openTest = (test) => (base ? navigate(`${base}/${test.path}`) : setActiveKey(test.key));

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

  const cards = [
    ...TESTS.map((t, i) => ({ ...t, locked: false, color: PALETTE[i % 8], Icon: ICONS[i % 8] })),
    ...LOCKED_MODULES.map((m, i) => ({ ...m, key: m.title, locked: true, color: PALETTE[(TESTS.length + i) % 8], Icon: ICONS[(TESTS.length + i) % 8] })),
  ];

  return (
    <div className="assessment-dashboard-v2">
      {contextHolder}
      <style>{`
        .assessment-dashboard-v2 { padding: 4px; }
        .adv2-header {
          position: relative;
          overflow: hidden;
          border-radius: 18px;
          padding: 22px 28px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          background: linear-gradient(100deg, #f8fafd 0%, #eef4fc 55%, #e6eefb 100%);
        }
        .adv2-welcome h1 { margin: 0 0 4px; font-size: 25px; font-weight: 800; color: #0b0b0b; }
        .adv2-welcome h1 span { color: ${PALETTE[6]}; }
        .adv2-welcome p { margin: 0; color: #52514e; font-size: 14px; }
        .adv2-keepgoing {
          display: flex; align-items: center; gap: 12px;
          background: rgba(255,255,255,0.7);
          border: 1px solid ${tint(PALETTE[0], 0.25)};
          border-radius: 14px;
          padding: 10px 18px;
        }
        .adv2-keepgoing .adv2-target {
          width: 38px; height: 38px; border-radius: 50%;
          background: ${tint(PALETTE[0], 0.15)};
          color: ${PALETTE[0]};
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; flex-shrink: 0;
        }
        .adv2-keepgoing strong { display: block; color: #0b0b0b; font-size: 13px; }
        .adv2-keepgoing span { display: block; color: #898781; font-size: 12px; }
        .adv2-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 18px;
        }
        @media (max-width: 1100px) { .adv2-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 700px) { .adv2-grid { grid-template-columns: 1fr; } }
        .adv2-card {
          position: relative;
          height: 198px;
          display: flex;
          flex-direction: column;
          border-radius: 14px;
          padding: 16px;
          cursor: pointer;
          overflow: hidden;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .adv2-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(11,11,11,0.08); }
        .adv2-card.locked { cursor: not-allowed; }
        .adv2-icon {
          width: 36px; height: 36px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 16px; margin-bottom: 8px; flex-shrink: 0;
        }
        .adv2-eyebrow {
          display: inline-block; align-self: flex-start;
          font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
          padding: 2px 9px; border-radius: 999px; margin-bottom: 7px; flex-shrink: 0;
        }
        .adv2-title {
          font-size: 15px; font-weight: 700; color: #0b0b0b; margin: 0 0 5px; line-height: 1.25;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .adv2-title.muted { color: #6b6a66; }
        .adv2-desc {
          font-size: 12.5px; color: #52514e; margin: 0;
          display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }
        .adv2-desc.muted { color: #898781; -webkit-line-clamp: 1; }
        .adv2-bullets { margin: 0; padding-left: 16px; overflow: hidden; max-height: 36px; }
        .adv2-bullets li {
          font-size: 12px; color: #898781; margin-bottom: 2px;
          display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
        }
        .adv2-footer { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 10px; flex-shrink: 0; }
        .adv2-duration { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #898781; }
        .adv2-arrow {
          width: 28px; height: 28px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          color: #fff; flex-shrink: 0; font-size: 12px;
        }
        .adv2-arrow.locked { background: #e1e0d9 !important; color: #898781; }
        .adv2-lock { position: absolute; top: 14px; right: 14px; color: #898781; font-size: 13px; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .adv2-header { background: linear-gradient(120deg, #1a2233 0%, #241f33 55%, #1a2a26 100%); }
          :root:not([data-theme="light"]) .adv2-welcome h1 { color: #ffffff; }
          :root:not([data-theme="light"]) .adv2-welcome p { color: #c3c2b7; }
          :root:not([data-theme="light"]) .adv2-keepgoing { background: rgba(255,255,255,0.06); }
          :root:not([data-theme="light"]) .adv2-keepgoing strong { color: #ffffff; }
          :root:not([data-theme="light"]) .adv2-title { color: #ffffff; }
          :root:not([data-theme="light"]) .adv2-desc { color: #c3c2b7; }
        }
        :root[data-theme="dark"] .adv2-header { background: linear-gradient(120deg, #1a2233 0%, #241f33 55%, #1a2a26 100%); }
        :root[data-theme="dark"] .adv2-welcome h1 { color: #ffffff; }
        :root[data-theme="dark"] .adv2-welcome p { color: #c3c2b7; }
        :root[data-theme="dark"] .adv2-keepgoing { background: rgba(255,255,255,0.06); }
        :root[data-theme="dark"] .adv2-keepgoing strong { color: #ffffff; }
        :root[data-theme="dark"] .adv2-title { color: #ffffff; }
        :root[data-theme="dark"] .adv2-desc { color: #c3c2b7; }
      `}</style>

      <div className="adv2-header">
        <div className="adv2-welcome">
          <h1>{firstName ? <>Welcome, <span>{firstName}</span></> : 'Your Assessment Dashboard'}</h1>
          <p>
            {firstName
              ? 'This is your assessment portal. Select an assessment to begin, or review your previous results.'
              : 'Select an assessment to begin, or review your previous results.'}
          </p>
        </div>
        <div className="adv2-keepgoing">
          <div className="adv2-target"><AimOutlined /></div>
          <div>
            <strong>Keep going!</strong>
            <span>Every assessment builds your future.</span>
          </div>
        </div>
      </div>

      <div className="adv2-grid">
        {cards.map((c) => (
          <div
            key={c.key}
            className={`adv2-card${c.locked ? ' locked' : ''}`}
            style={{ background: tint(c.color, 0.08), border: `1px solid ${tint(c.color, 0.28)}` }}
            onClick={() => (c.locked ? clickLocked(c.title) : openTest(c))}
          >
            {c.locked && <LockOutlined className="adv2-lock" />}
            <div className="adv2-icon" style={{ background: c.color }}>
              <c.Icon />
            </div>
            <span className="adv2-eyebrow" style={{ background: tint(c.color, 0.15), color: c.color }}>{c.eyebrow}</span>
            <h3 className={`adv2-title${c.locked ? ' muted' : ''}`}>{c.title}</h3>
            {c.locked ? (
              c.bullets ? (
                <ul className="adv2-bullets">
                  {c.bullets.map((b) => <li key={b}>{b}</li>)}
                </ul>
              ) : (
                <p className="adv2-desc muted">Coming soon</p>
              )
            ) : (
              <p className="adv2-desc">{c.description}</p>
            )}
            <div className="adv2-footer">
              <span className="adv2-duration">
                <ClockCircleOutlined /> {c.locked ? 'Coming soon' : c.duration}
              </span>
              <div className={`adv2-arrow${c.locked ? ' locked' : ''}`} style={c.locked ? undefined : { background: c.color }}>
                <ArrowRightOutlined />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
