import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Select, Skeleton, message, Tooltip, Modal, Form, Input, Segmented, Tag } from 'antd';
import {
  LockOutlined,
  UnlockOutlined,
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
  CloseOutlined,
} from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import { selectCurrentAdmin } from '@/redux/auth/selectors';
import { LMS_TEACHER_ROLES } from '@/config/roles';
import { request } from '@/request';
import lmsApi from '@/pages/Lms/api';
import { BasicTest, MajorTestPythonSql, MajorTestNlp, MajorTestLlm, MicroTestSqlDb, MicroTestNlpSerp } from '../TestIntro/variants';
import './AssessmentDashboard.css';
import './asx.css';

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
  { key: 'major-llm', testType: 'LLM_MAJOR', path: 'tests/major/llm', Component: MajorTestLlm, eyebrow: 'Comprehensive Assessment', title: 'LLM APIs & Prompt Engineering', description: 'LLM API fundamentals, advanced prompt engineering, structured output & function calling, LangChain, LlamaIndex & RAG, and vector databases & semantic search.', duration: '~90 mins' },
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

  // Manual curriculum-gate bypass (manager only) — overrides active for the
  // selected batch, keyed by testType, so a locked-but-overridden card can
  // show "manually unlocked" + a revoke action instead of just "locked".
  const [overrides, setOverrides] = useState([]);
  const [unlockForm] = Form.useForm();
  const [unlockModal, setUnlockModal] = useState(null); // the card being unlocked, or null
  const [unlockSaving, setUnlockSaving] = useState(false);

  const loadOverrides = useCallback(() => {
    if (!isManagerRole || !batch) { setOverrides([]); return; }
    lmsApi.listUnlockOverrides({ batch }).then((r) => setOverrides((r && r.result) || [])).catch(() => setOverrides([]));
  }, [isManagerRole, batch]);
  useEffect(() => { loadOverrides(); }, [loadOverrides]);

  const batchOverrideByType = useMemo(() => {
    const m = {};
    overrides.filter((o) => o.scope === 'batch').forEach((o) => { m[o.testType] = o; });
    return m;
  }, [overrides]);

  const openUnlockModal = (card) => {
    unlockForm.resetFields();
    unlockForm.setFieldsValue({ scope: 'batch', batch });
    setUnlockModal(card);
  };
  const submitUnlock = async () => {
    let v;
    try { v = await unlockForm.validateFields(); } catch (e) { return; }
    setUnlockSaving(true);
    try {
      await lmsApi.grantUnlockOverride({
        testType: unlockModal.testType,
        scope: v.scope,
        batch: v.scope === 'batch' ? batch : undefined,
        studentEmail: v.scope === 'student' ? v.studentEmail : undefined,
        note: v.note,
      });
      msgApi.success('Unlocked.');
      setUnlockModal(null);
      loadOverrides();
      lmsApi.assessmentBatchProgress(batch).then((res) => setProgress((res && res.result) || null)).catch(() => {});
    } catch (e) {
      msgApi.error(e?.response?.data?.message || 'Could not unlock.');
    } finally {
      setUnlockSaving(false);
    }
  };
  const revokeOverride = async (id) => {
    try {
      await lmsApi.revokeUnlockOverride(id);
      msgApi.success('Reverted to the normal % threshold.');
      loadOverrides();
      lmsApi.assessmentBatchProgress(batch).then((res) => setProgress((res && res.result) || null)).catch(() => {});
    } catch (e) {
      msgApi.error('Could not revoke.');
    }
  };

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

  const staff = isTeacher || isManagerRole;
  const cur = (progress && progress.curriculumPercent) || 0;
  const openN = cards.filter((c) => !c.locked).length;
  const nextLocked = cards.filter((c) => c.locked).sort((a, b) => (thresholds[a.testType] || 0) - (thresholds[b.testType] || 0))[0];
  const marks = cards
    .map((c) => ({ key: c.key, at: Math.min(100, thresholds[c.testType] || 0), color: c.color, title: c.title, open: !c.locked }))
    .sort((a, b) => a.at - b.at);
  const batchRow = batches.find((b) => b.name === batch);

  return (
    <div className="asx">
      {contextHolder}

      <div className="asx-hero">
        <div className="asx-hero-l">
          <span className="asx-hero-ic"><FileDoneOutlined /></span>
          <div style={{ minWidth: 0 }}>
            <span className="asx-kicker"><AimOutlined /> {staff ? 'Assessment control' : 'Assessment portal'}</span>
            <h1>{staff ? 'Assessments' : firstName ? <>Welcome, <span>{firstName}</span></> : 'Your assessments'}</h1>
            <p>
              {staff
                ? 'Every test unlocks automatically once the batch has covered enough of its curriculum. Pick a batch to see where it stands — and unlock a test early if needed.'
                : 'Each test opens as your batch covers more of the curriculum. Pick an open test to begin — locked ones show how far away they are.'}
            </p>
          </div>
        </div>
        {staff && !batchesLoading && batches.length > 0 && (
          <div className="asx-batch">
            <small>Batch</small>
            <Select
              value={batch}
              onChange={setBatch}
              style={{ width: '100%' }}
              options={batches.map((b) => ({ value: b.name, label: b.course ? `${b.name} — ${b.course}` : b.name }))}
              showSearch
              optionFilterProp="label"
              popupMatchSelectWidth={false}
            />
            {batchRow && batchRow.course && <span className="asx-batch-sub">{batchRow.course}</span>}
          </div>
        )}
      </div>

      {progress && (
        <section className="asx-track" aria-label="Curriculum progress and unlocks">
          <div className="asx-track-top">
            <div className="asx-track-big">
              <b>{cur}%</b>
              <span>curriculum delivered{!staff && batch ? ` · ${batch}` : ''}</span>
            </div>
            <div className="asx-track-stats">
              <span className="asx-ts"><b>{TRACK_LABEL[progress.resolvedTrack] || progress.resolvedTrack || '—'}</b><small>Track</small></span>
              <span className="asx-ts ok"><b>{openN}/{cards.length}</b><small>Tests open</small></span>
              <span className="asx-ts"><b>{nextLocked ? `${thresholds[nextLocked.testType] || 0}%` : 'All open'}</b><small>{nextLocked ? `Next unlock · ${Math.max(0, (thresholds[nextLocked.testType] || 0) - cur)}% to go` : 'Nothing locked'}</small></span>
            </div>
          </div>
          <div className="asx-bar">
            <div className="asx-bar-fill" style={{ width: `${Math.min(100, cur)}%` }} />
            {marks.map((m) => (
              <Tooltip key={m.key} title={`${m.title} — unlocks at ${m.at}%${m.open ? ' · open' : ''}`}>
                <span className={`asx-mark${m.open ? ' open' : ''}`} style={{ left: `${m.at}%`, '--c': m.color }}>{m.open ? <UnlockOutlined /> : <LockOutlined />}</span>
              </Tooltip>
            ))}
          </div>
          <div className="asx-bar-scale"><span>0%</span><span>50%</span><span>100%</span></div>
          <div className="asx-note">
            <InfoCircleOutlined /> The % comes from the Curriculum Tracker (topics marked delivered). Each marker on the bar is a test&apos;s unlock point.
          </div>
        </section>
      )}

      <div className="asx-sec">
        <div>
          <h2>{staff ? 'Tests for this batch' : 'Your assessments'}</h2>
          <p>{openN} open · {cards.length - openN} locked</p>
        </div>
      </div>

      {progressLoading || batchesLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (
        <div className="asx-grid">
          {cards.map((c) => {
            const need = thresholds[c.testType] || 0;
            const ov = isManagerRole && batchOverrideByType[c.testType];
            const reach = need ? Math.min(100, Math.round((cur / need) * 100)) : 100;
            return (
              <article
                key={c.key}
                className={`asx-card${c.locked ? ' locked' : ''}`}
                style={{ '--c': c.color, '--ct': tint(c.color, 0.1), '--cb': tint(c.color, 0.3) }}
                role="button"
                tabIndex={0}
                onClick={() => (c.locked ? clickLocked(c) : openTest(c))}
                onKeyDown={(e) => { if (e.key === 'Enter') (c.locked ? clickLocked(c) : openTest(c)); }}
              >
                <div className="asx-card-top">
                  <span className="asx-card-ic"><c.Icon /></span>
                  <span className={`asx-state ${c.locked ? 'lock' : 'open'}`}>{c.locked ? <><LockOutlined /> Locked</> : <><UnlockOutlined /> Open</>}</span>
                </div>
                <span className="asx-eyebrow">{c.eyebrow}</span>
                <h3>{c.title}</h3>
                <p className="asx-desc">{c.description}</p>
                <div className="asx-meta">
                  <span><ClockCircleOutlined /> {c.duration}</span>
                  <span>{need ? <><AimOutlined /> Unlocks at {need}%</> : <><UnlockOutlined /> Always open</>}</span>
                </div>
                {c.locked && (
                  <div className="asx-reach">
                    <div className="asx-reach-bar"><div style={{ width: `${reach}%` }} /></div>
                    <small>{cur}% of {need}% · {Math.max(0, need - cur)}% to go</small>
                  </div>
                )}
                {ov && (
                  <Tag
                    color="purple"
                    style={{ margin: 0, alignSelf: 'flex-start' }}
                    closeIcon={<CloseOutlined />}
                    onClose={(e) => { e.preventDefault(); e.stopPropagation(); revokeOverride(ov.id); }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Manually unlocked for this batch
                  </Tag>
                )}
                <div className="asx-foot">
                  {c.locked ? (
                    isManagerRole ? (
                      <Button icon={<UnlockOutlined />} onClick={(e) => { e.stopPropagation(); openUnlockModal(c); }}>Unlock early…</Button>
                    ) : (
                      <span className="asx-foot-lock"><LockOutlined /> Opens automatically</span>
                    )
                  ) : (
                    <span className="asx-go">{staff ? 'Open test' : 'Start test'} <ArrowRightOutlined /></span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        className="crud-modal"
        centered
        title={unlockModal ? `Unlock "${unlockModal.title}" early` : ''}
        open={!!unlockModal}
        onCancel={() => setUnlockModal(null)}
        onOk={submitUnlock}
        confirmLoading={unlockSaving}
        okText="Unlock"
        destroyOnClose
      >
        <p style={{ color: '#667085', marginTop: -4 }}>
          Opens this test without waiting for the curriculum % threshold — the threshold itself is unchanged for
          everyone else.
        </p>
        <Form form={unlockForm} layout="vertical" preserve={false}>
          <Form.Item name="scope" label="Who should this open for?">
            <Segmented
              options={[
                { label: `This batch (${batch})`, value: 'batch' },
                { label: 'A specific learner', value: 'student' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.scope !== c.scope}>
            {({ getFieldValue }) =>
              getFieldValue('scope') === 'student' ? (
                <Form.Item
                  name="studentEmail"
                  label="Learner's email"
                  rules={[{ required: true, type: 'email', message: 'A valid email is required' }]}
                >
                  <Input placeholder="candidate@email.com" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="note" label="Note (optional)">
            <Input.TextArea rows={2} placeholder="e.g. Scheduled assessment on Friday, delivery tracker is lagging actual classes" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
