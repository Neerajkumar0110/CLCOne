import React, { useEffect, useMemo, useState } from 'react';
import { Button, Select, Skeleton, message, Tooltip } from 'antd';
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
  InfoCircleOutlined,
  FileDoneOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '@/pages/Lms/api';
import { BasicTest, MajorTestPythonSql, MajorTestNlp, MicroTestSqlDb, MicroTestNlpSerp } from '../TestIntro/variants';
import './AssessmentDashboard.css';

const TRACK_LABEL = { FOUNDATION: 'Foundation (6-Month)', ELITE: 'Elite (12-Month)' };
const MGR = ['owner', 'Super Admin', 'Admin', 'Sales Manager', 'Support'];

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
  { key: 'basic', testType: 'BASIC', path: 'tests/basic', Component: BasicTest, eyebrow: 'Foundational Assessment', title: 'Basic Test', description: 'Multiple-choice, output-based, and short programming questions covering core fundamentals.', duration: '~60 mins' },
  { key: 'major-python-sql', testType: 'MAJOR', path: 'tests/major/python-sql', Component: MajorTestPythonSql, eyebrow: 'Comprehensive Assessment', title: 'Python Programming Foundations & SQL Basics', description: 'In-depth, advanced-level questions administered under full proctoring.', duration: '~90 mins' },
  { key: 'micro-sql-db', testType: 'MICRO', path: 'tests/micro/sql-db', Component: MicroTestSqlDb, eyebrow: 'Applied Project', title: 'Micro Test — SQL-Backed Keyword Database', description: 'Design and query a SQL-backed keyword database.', duration: '~45 mins' },
  { key: 'micro-nlp-serp', testType: 'NLP_MICRO', path: 'tests/micro/nlp-serp', Component: MicroTestNlpSerp, eyebrow: 'Applied Project', title: 'Micro Test — NLP on a SERP Dataset', description: 'Given 20 scraped article titles: extract keywords, classify intent, output ranked report.', duration: '~60 mins' },
  { key: 'major-nlp', testType: 'NLP_MAJOR', path: 'tests/major/nlp', Component: MajorTestNlp, eyebrow: 'Comprehensive Assessment', title: 'NLP Fundamentals & Introduction to LLMs', description: 'Text preprocessing, POS tagging & NER, TF-IDF/YAKE keyword extraction, embeddings, sentiment analysis, and LLM fundamentals.', duration: '~90 mins' },
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
  const isTeacher = LMS_TEACHER_ROLES.includes(admin.role);
  const isManagerRole = MGR.includes(admin.role);
  const [msgApi, contextHolder] = message.useMessage();
  const [activeKey, setActiveKey] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Teacher: pick from their own batches (they may teach several). Manager
  // (Admin/Super Admin/Support): pick from EVERY batch in the system — they
  // aren't a trainer on anything, so the trainer-scoped teacherDashboard()
  // batch list would always come back empty for them. Student: auto-resolved
  // to their own enrolled batch, same pattern as Curriculum/index.jsx's
  // StudentCurriculum — no picker needed.
  const [batches, setBatches] = useState([]);
  const [batch, setBatch] = useState(null);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [progress, setProgress] = useState(null); // { resolvedTrack, curriculumPercent, unlockedByType }
  const [progressLoading, setProgressLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (isTeacher) {
        const res = await lmsApi.teacherDashboard().catch(() => null);
        const rows = (res && res.result && res.result.batches) || [];
        setBatches(rows);
        if (rows.length) setBatch(rows[0].name);
      } else if (isManagerRole) {
        const res = await request.list({ entity: 'batch', options: { items: 500, sortBy: 'name', sortValue: 1 } }).catch(() => null);
        const rows = (res && res.result) || [];
        setBatches(rows);
        if (rows.length) setBatch(rows[0].name);
      } else {
        const res = await lmsApi.studentDashboard().catch(() => null);
        const enrolment = ((res && res.result && res.result.courses) || []).find((c) => c.batch);
        if (enrolment) setBatch(enrolment.batch);
      }
      setBatchesLoading(false);
    })();
  }, [isTeacher, isManagerRole]);

  useEffect(() => {
    if (!batch) { setProgress(null); setProgressLoading(false); return; }
    setProgressLoading(true);
    lmsApi.assessmentBatchProgress(batch)
      .then((res) => setProgress((res && res.result) || null))
      .catch(() => setProgress(null))
      .finally(() => setProgressLoading(false));
  }, [batch]);

  // On the Teacher/Student sidebar (LmsPanelApp), each test already has its
  // own real route under the sidebar's "Quizzes & Exams" group — navigate
  // there so the sidebar highlights it and the URL/back button work
  // normally. Inside the Admin console's ModuleScaffold embed there is no
  // such route, so fall back to rendering the test in place.
  const base = location.pathname.startsWith('/teacher') ? '/teacher' : location.pathname.startsWith('/learn') ? '/learn' : null;

  const firstName = (admin.name || '').trim().split(' ')[0];
  const openTest = (test) => (base ? navigate(`${base}/${test.path}`) : setActiveKey(test.key));

  // Always the same 5 real tests, for every batch/track — only their lock
  // state differs, driven by the batch's real curriculum completion %
  // (services/lms/curriculumTracker.js) against each test's own threshold.
  const unlockedByType = (progress && progress.unlockedByType) || {};
  const thresholds = (progress && progress.thresholds) || {};

  const cards = TESTS.map((t, i) => ({
    ...t,
    locked: progress ? unlockedByType[t.testType] === false : false,
    color: PALETTE[i % 8],
    Icon: ICONS[i % 8],
  }));

  const clickLocked = (card) => {
    const req = thresholds[card.testType] || 0;
    const cur = (progress && progress.curriculumPercent) || 0;
    msgApi.info(`"${card.title}" unlocks once ${req}% of your batch's curriculum has been delivered (currently ${cur}%).`, 4);
  };

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
    <div className="assessment-dashboard-v2">
      {contextHolder}

      <div className="asm-hero">
        <div className="asm-hero-dot asm-hero-dot-1" />
        <div className="asm-hero-dot asm-hero-dot-2" />

        <div className="asm-hero-left">
          <div className="asm-hero-illustration">
            <FileDoneOutlined />
          </div>

          <div className="asm-hero-content">
            <div className="asm-hero-label">
              <AimOutlined /> ASSESSMENT PORTAL
            </div>
            <h1>{firstName ? <>Welcome, <span>{firstName}</span></> : 'Your Assessment Dashboard'}</h1>
            <p>
              {firstName
                ? 'This is your assessment portal. Select an assessment to begin, or review your previous results.'
                : 'Select an assessment to begin, or review your previous results.'}
            </p>
          </div>
        </div>

        <div className="asm-keepgoing">
          <div className="asm-keepgoing-icon"><AimOutlined /></div>
          <div>
            <strong>Keep going!</strong>
            <p>Every assessment builds your future.</p>
          </div>
          <ArrowRightOutlined className="asm-keepgoing-arrow" />
        </div>
      </div>

      {(isTeacher || isManagerRole) && !batchesLoading && batches.length > 0 && (
        <div className="asm-batchbar">
          <span className="asm-batchbar-label">Batch</span>
          <Select
            value={batch}
            onChange={setBatch}
            style={{ minWidth: 260 }}
            options={batches.map((b) => ({ value: b.name, label: b.course ? `${b.name} — ${b.course}` : b.name }))}
            showSearch
            optionFilterProp="label"
          />
          {progress && (
            <span className="asm-course-info">
              {TRACK_LABEL[progress.resolvedTrack] || progress.resolvedTrack} <b>•</b> {progress.curriculumPercent}% curriculum delivered
              <Tooltip title="How much of this batch's curriculum has been marked delivered/completed so far — see the Curriculum Tracker tab. Each test below unlocks once this crosses its own threshold.">
                <InfoCircleOutlined className="asm-info-icon" />
              </Tooltip>
            </span>
          )}
        </div>
      )}
      {!isTeacher && !isManagerRole && !batchesLoading && progress && (
        <div className="asm-course-info">
          <span>{batch}</span>
          <b>•</b>
          <span>{TRACK_LABEL[progress.resolvedTrack] || progress.resolvedTrack}</span>
          <b>•</b>
          <span>{progress.curriculumPercent}% curriculum delivered</span>
          <Tooltip title="How much of your batch's curriculum has been marked delivered/completed so far — see the Curriculum Tracker tab. Each test below unlocks once this crosses its own threshold.">
            <InfoCircleOutlined className="asm-info-icon" />
          </Tooltip>
        </div>
      )}

      <div className="asm-section-header">
        <div className="asm-section-title">
          <div className="asm-section-icon">
            <FileTextOutlined />
          </div>
          <div>
            <h2>Your Assessments</h2>
            <p>Explore and complete your assessments. Track your progress and performance.</p>
          </div>
        </div>
        <span className="asm-count">{cards.length} Assessments</span>
      </div>

      {progressLoading || batchesLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div className="asm-grid">
          {cards.map((c) => (
            <article
              key={c.key}
              className={`asm-card${c.locked ? ' is-locked' : ''}`}
              style={{ background: tint(c.color, 0.08), border: `1px solid ${tint(c.color, 0.28)}` }}
              onClick={() => (c.locked ? clickLocked(c) : openTest(c))}
            >
              <c.Icon className="asm-card-decoration" style={{ color: c.color }} />

              <div className="asm-card-top">
                <div className="asm-card-icon" style={{ background: c.color }}>
                  <c.Icon />
                </div>
                {c.locked && <LockOutlined className="asm-card-lock" />}
              </div>

              <span className="asm-type" style={{ background: tint(c.color, 0.15), color: c.color }}>{c.eyebrow}</span>

              <h3 className={c.locked ? 'is-muted' : ''}>{c.title}</h3>
              <p className={`asm-desc${c.locked ? ' is-muted' : ''}`}>{c.description}</p>

              {c.locked ? (
                <div className="asm-card-bottom asm-locked-bottom">
                  <span className="asm-unlock-text">
                    <LockOutlined /> Unlocks at {thresholds[c.testType] || 0}%
                    {progress ? ` (now ${progress.curriculumPercent}%)` : ''}
                  </span>
                  <div className="asm-locked-button">
                    <LockOutlined />
                  </div>
                </div>
              ) : (
                <div className="asm-card-bottom asm-unlocked-bottom">
                  <span className="asm-duration">
                    <ClockCircleOutlined /> {c.duration}
                  </span>
                  <div className="asm-progress-area">
                    <div className="asm-progress-circle" style={{ '--card-color': c.color, '--pct': '0%' }}>
                      <span />
                    </div>
                    <div className="asm-progress-text">
                      <strong>0% completed</strong>
                      <div className="asm-progress-line" style={{ '--card-color': c.color, '--pct': '0%' }}>
                        <span />
                      </div>
                    </div>
                  </div>
                  <button type="button" className="asm-start-btn" style={{ background: c.color }}>
                    <ArrowRightOutlined />
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
