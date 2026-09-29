import React, { useEffect, useMemo, useState } from 'react';
import { Button, Select, Skeleton, message } from 'antd';
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
import { LMS_TEACHER_ROLES } from '@/config/roles';
import lmsApi from '@/pages/Lms/api';
import { BasicTest, MajorTestPythonSql, MajorTestNlp, MicroTestSqlDb, MicroTestNlpSerp } from '../TestIntro/variants';

const TRACK_LABEL = { FOUNDATION: 'Foundation (6-Month)', ELITE: 'Elite (12-Month)' };
// Fallback only — used when a Foundation batch's course has no native
// Chapters built yet (backend then returns units: null) so there's nothing
// to build per-unit cards from; falls back to the 3 core test types instead
// of showing NLP cards that don't apply to a 6-month curriculum at all.
const TRACK_TEST_TYPES = { FOUNDATION: ['BASIC', 'MAJOR', 'MICRO'], ELITE: ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'] };

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
  const [msgApi, contextHolder] = message.useMessage();
  const [activeKey, setActiveKey] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Teacher: pick from their own batches (they may teach several). Student:
  // auto-resolved to their own enrolled batch, same pattern as
  // Curriculum/index.jsx's StudentCurriculum — no picker needed.
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
      } else {
        const res = await lmsApi.studentDashboard().catch(() => null);
        const enrolment = ((res && res.result && res.result.courses) || []).find((c) => c.batch);
        if (enrolment) setBatch(enrolment.batch);
      }
      setBatchesLoading(false);
    })();
  }, [isTeacher]);

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

  // Foundation (6-month): one card per real curriculum unit — see
  // testController.js#getBatchProgress, which already maps each unit to
  // whichever of the 3 core tests it falls under and only reports `units`
  // for a track that actually has native Chapters built. Elite (12-month)
  // keeps the flat 5-test view unchanged. If a Foundation batch's course has
  // no native chapters yet, `units` is null and it falls back to the same
  // flat view scoped to the 3 core types.
  const units = progress && progress.units;
  const isUnitMode = Array.isArray(units) && units.length > 0;

  const unlockedByType = (progress && progress.unlockedByType) || {};
  const thresholds = (progress && progress.thresholds) || {};
  const applicableTypes = progress && progress.resolvedTrack ? TRACK_TEST_TYPES[progress.resolvedTrack] : null;
  const visibleTests = applicableTypes ? TESTS.filter((t) => applicableTypes.includes(t.testType)) : TESTS;

  const cards = isUnitMode
    ? units.map((u, i) => {
        const mapped = TESTS.find((t) => t.testType === u.testType) || TESTS[0];
        return {
          key: `unit-${u.id}`,
          testType: u.testType,
          path: mapped.path,
          Component: mapped.Component,
          eyebrow: `Unit ${i + 1}`,
          title: u.title,
          description: `${u.completedChapters}/${u.totalChapters} sessions delivered · opens the ${mapped.title}.`,
          duration: mapped.duration,
          locked: !u.completed,
          color: PALETTE[i % 8],
          Icon: ICONS[i % 8],
        };
      })
    : visibleTests.map((t, i) => ({
        ...t,
        locked: progress ? unlockedByType[t.testType] === false : false,
        color: PALETTE[i % 8],
        Icon: ICONS[i % 8],
      }));

  const clickLocked = (card) => {
    if (isUnitMode) {
      msgApi.info(`"${card.title}" unlocks once this unit's curriculum has been fully delivered.`, 4);
      return;
    }
    const req = thresholds[card.testType] || 0;
    const cur = (progress && progress.curriculumPercent) || 0;
    msgApi.info(`"${card.title}" unlocks once ${req}% of your batch's curriculum has been delivered (currently ${cur}%).`, 4);
  };

  if (activeKey) {
    const active = cards.find((c) => c.key === activeKey) || TESTS.find((t) => t.key === activeKey);
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
        .adv2-batchbar {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .adv2-batchbar-label { font-size: 12px; font-weight: 700; color: #52514e; text-transform: uppercase; letter-spacing: .3px; }
        .adv2-batchbar-meta { font-size: 12.5px; color: #52514e; }
        :root[data-theme="dark"] .adv2-batchbar-label,
        :root[data-theme="dark"] .adv2-batchbar-meta,
        :root:not([data-theme="light"]) .adv2-batchbar-label,
        :root:not([data-theme="light"]) .adv2-batchbar-meta { color: #c3c2b7; }
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

      {isTeacher && !batchesLoading && batches.length > 0 && (
        <div className="adv2-batchbar">
          <span className="adv2-batchbar-label">Batch</span>
          <Select
            value={batch}
            onChange={setBatch}
            style={{ minWidth: 260 }}
            options={batches.map((b) => ({ value: b.name, label: b.name }))}
            showSearch
            optionFilterProp="label"
          />
          {progress && (
            <span className="adv2-batchbar-meta">
              {TRACK_LABEL[progress.resolvedTrack] || progress.resolvedTrack} · {progress.curriculumPercent}% curriculum delivered
            </span>
          )}
        </div>
      )}
      {!isTeacher && !batchesLoading && progress && (
        <div className="adv2-batchbar">
          <span className="adv2-batchbar-meta">
            <b>{batch}</b> · {TRACK_LABEL[progress.resolvedTrack] || progress.resolvedTrack} · {progress.curriculumPercent}% curriculum delivered
          </span>
        </div>
      )}

      {progressLoading || batchesLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div className="adv2-grid">
          {cards.map((c) => (
            <div
              key={c.key}
              className={`adv2-card${c.locked ? ' locked' : ''}`}
              style={{ background: tint(c.color, 0.08), border: `1px solid ${tint(c.color, 0.28)}` }}
              onClick={() => (c.locked ? clickLocked(c) : openTest(c))}
            >
              {c.locked && <LockOutlined className="adv2-lock" />}
              <div className="adv2-icon" style={{ background: c.color }}>
                <c.Icon />
              </div>
              <span className="adv2-eyebrow" style={{ background: tint(c.color, 0.15), color: c.color }}>{c.eyebrow}</span>
              <h3 className={`adv2-title${c.locked ? ' muted' : ''}`}>{c.title}</h3>
              <p className={`adv2-desc${c.locked ? ' muted' : ''}`}>{c.description}</p>
              <div className="adv2-footer">
                <span className="adv2-duration">
                  {c.locked ? (
                    isUnitMode ? (
                      <><LockOutlined /> Complete this unit to unlock</>
                    ) : (
                      <>
                        <LockOutlined /> Unlocks at {thresholds[c.testType] || 0}%
                        {progress ? ` (now ${progress.curriculumPercent}%)` : ''}
                      </>
                    )
                  ) : (
                    <><ClockCircleOutlined /> {c.duration}</>
                  )}
                </span>
                <div className={`adv2-arrow${c.locked ? ' locked' : ''}`} style={c.locked ? undefined : { background: c.color }}>
                  {c.locked ? <LockOutlined /> : <ArrowRightOutlined />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
