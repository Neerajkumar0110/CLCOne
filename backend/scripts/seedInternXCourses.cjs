/* Seeds the two InternX-AI courses (Foundation + Elite) from the curriculum
 * transcribed in scripts/data/internxCurriculum.js, plus a generated
 * branded thumbnail (embedded as a data: URI — no file hosting needed, so
 * it renders the same whether the frontend is pointed at a local or
 * production backend).
 *
 * Idempotent: matches each Course by title, then wipes and re-creates that
 * course's Modules/Chapters every run — safe to re-run while iterating on
 * the data file.
 *
 * LOCAL-ONLY CHECK — this does not get run by the app or CI. Run by hand:
 *   node scripts/seedInternXCourses.cjs
 */
const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const { buildInternXThumbnailSvg } = require('./lib/internxThumbnail');
const { FOUNDATION_UNITS, ELITE_ADDITIONAL_UNITS, FOUNDATION_TOTALS, ELITE_TOTALS } = require('./data/internxCurriculum');

function svgDataUri(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function chapterDescription(points) {
  return (points || []).filter(Boolean).map((p) => (p ? `• ${p}` : '')).join('\n');
}

function assessmentDescription(a) {
  const lines = [];
  if (a.duration) lines.push(`Duration: ${a.duration}`);
  if (a.passMark) lines.push(`Pass mark: ${a.passMark}`);
  if (a.weight) lines.push(`Weight: ${a.weight}`);
  lines.push('');
  (a.details || []).forEach((d) => lines.push(d));
  return lines.join('\n');
}

async function upsertCourse(Course, fields) {
  let course = await Course.findOne({ title: fields.title });
  if (course) {
    Object.assign(course, fields);
    course.removed = false;
    course.updated = new Date();
    await course.save();
  } else {
    course = await Course.create(fields);
  }
  return course;
}

async function wipeCurriculum(CourseModule, Chapter, courseId) {
  const oldModules = await CourseModule.find({ course: courseId }).select('_id');
  const oldModuleIds = oldModules.map((m) => m._id);
  await Chapter.deleteMany({ course: courseId });
  await CourseModule.deleteMany({ course: courseId });
  return oldModuleIds.length;
}

async function createUnitModule(CourseModule, Chapter, courseId, unit, order) {
  const weeksLine = unit.weeks ? `Weeks ${unit.weeks} · ${unit.sessions} sessions · ${unit.hours} hours.` : '';
  const description = [unit.overview, weeksLine].filter(Boolean).join('\n\n');

  const mod = await CourseModule.create({
    course: courseId,
    title: unit.title,
    description,
    hours: unit.hours,
    order,
  });

  let chapterOrder = 0;
  for (const ch of unit.chapters) {
    await Chapter.create({
      course: courseId,
      module: mod._id,
      title: ch.title,
      description: chapterDescription(ch.points),
      sessionLabel: ch.sessionLabel,
      hours: ch.hours === null || ch.hours === undefined ? undefined : ch.hours,
      order: chapterOrder++,
    });
  }

  if (unit.assessment) {
    await Chapter.create({
      course: courseId,
      module: mod._id,
      title: unit.assessment.title,
      description: assessmentDescription(unit.assessment),
      sessionLabel: 'Assessment',
      order: chapterOrder++,
    });
  }

  return mod;
}

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to seed.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  const Course = require('../src/models/appModels/Course');
  const CourseModule = require('../src/models/appModels/CourseModule');
  const Chapter = require('../src/models/appModels/Chapter');

  const INSTRUCTOR = 'Sandeep Yadav';

  // ── Foundation ──────────────────────────────────────────────────────
  const foundation = await upsertCourse(Course, {
    title: 'InternX-AI — Foundation',
    category: 'Technical',
    level: 'Beginner',
    mode: 'Live',
    language: 'English',
    durationHours: 6, // months — see Course.js field comment, UI labels this "Duration (months)"
    instructor: INSTRUCTOR,
    status: 'Draft',
    thumbnailUrl: svgDataUri(buildInternXThumbnailSvg({ track: 'Foundation' })),
    prerequisites: 'No prior coding experience required — starts from Python setup and builds up.',
    outcomes:
      'By the end of the Foundation plan, students can build autonomous AI agents (ReAct + LangGraph), integrate LLM APIs and RAG pipelines, train and explain ML models for real SEO use cases, and ship a containerised, cloud-deployed capstone system in a domain of their choice, presented live to an industry panel.',
    description:
      `InternX-AI Foundation is a 6-month, ${FOUNDATION_TOTALS.weeks}-week, ${FOUNDATION_TOTALS.sessions}-session (${FOUNDATION_TOTALS.hours} hour) hands-on programme: Python & SQL foundations → NLP & LLM fundamentals → LLM APIs & prompt engineering → ML & probability for agent builders → AI agent architecture & design patterns → SEO domain knowledge & agent feature engineering → agent productionisation and a choice-based autonomous-system capstone project (15 domain tracks to choose from). Curriculum designed & developed by AI Engineer Sandeep Yadav.`,
  });
  await wipeCurriculum(CourseModule, Chapter, foundation._id);
  let order = 0;
  for (const unit of FOUNDATION_UNITS) {
    await createUnitModule(CourseModule, Chapter, foundation._id, unit, order++);
  }
  console.log(`Foundation course ready: ${foundation._id} (${FOUNDATION_UNITS.length} units)`);

  // ── Elite ───────────────────────────────────────────────────────────
  const elite = await upsertCourse(Course, {
    title: 'InternX-AI — Elite',
    category: 'Technical',
    level: 'Advanced',
    mode: 'Live',
    language: 'English',
    durationHours: 12, // months
    instructor: INSTRUCTOR,
    status: 'Draft',
    thumbnailUrl: svgDataUri(buildInternXThumbnailSvg({ track: 'Elite', subtitle: 'From Learning to Leading — Enterprise Ready.' })),
    prerequisites: 'Same starting point as Foundation (no prior coding experience required) — Elite is the full 12-month track that includes Foundation plus 6 advanced units.',
    outcomes:
      'Everything in Foundation, plus: advanced ML engineering (LoRA/QLoRA fine-tuning, RL for agents), system design for large-scale agent platforms, cloud/MLOps/DevOps (Kubernetes, CI/CD, Terraform), AI research skills, and product/business skills for shipping an AI agent as a real product — culminating in an Enterprise AI Agent Platform capstone presented to an industry panel.',
    description:
      `InternX-AI Elite is a 12-month, ${ELITE_TOTALS.weeks}-week, ${ELITE_TOTALS.sessions}-session (${ELITE_TOTALS.hours} hour) programme. Weeks 1-37 are the full Foundation plan (Track A1 — see the InternX-AI Foundation course for its session-by-session breakdown); weeks 38-64 add: Machine Learning Engineering (Advanced), System Design for AI Agent Systems, Cloud Deployment/MLOps/DevOps, AI Research Skills & Staying Current, Product Development & Business of AI Agents, and an Advanced Capstone — Enterprise AI Agent Platform. Curriculum designed & developed by AI Engineer Sandeep Yadav.`,
  });
  await wipeCurriculum(CourseModule, Chapter, elite._id);
  order = 0;
  // Unit 01-07 rolled up as one summary module (see the Foundation course for the full breakdown).
  const rollup = await CourseModule.create({
    course: elite._id,
    title: 'Unit 01-07 — Foundation Plan (Track A1)',
    description:
      `The full 6-month Foundation plan: Python & SQL, NLP & LLM fundamentals, LLM APIs & prompt engineering, ML & probability for agent builders, AI agent architecture, SEO domain knowledge & agent feature engineering, and agent productionisation with a choice-based capstone.\n\nSee the "InternX-AI — Foundation" course for the full unit-by-unit, session-by-session breakdown (${FOUNDATION_TOTALS.sessions} sessions).`,
    hours: FOUNDATION_TOTALS.hours,
    order: order++,
  });
  await Chapter.create({
    course: elite._id,
    module: rollup._id,
    title: 'Weeks 1-37 — see the InternX-AI Foundation course',
    description: `${FOUNDATION_TOTALS.sessions} sessions across 7 units — Python & SQL, NLP/LLM fundamentals, LLM APIs & prompt engineering, ML & probability, AI agent architecture, SEO domain knowledge, agent productionisation & capstone.`,
    hours: FOUNDATION_TOTALS.hours,
    order: 0,
  });
  for (const unit of ELITE_ADDITIONAL_UNITS) {
    await createUnitModule(CourseModule, Chapter, elite._id, unit, order++);
  }
  console.log(`Elite course ready: ${elite._id} (1 rollup + ${ELITE_ADDITIONAL_UNITS.length} advanced units)`);

  // ── verify ──────────────────────────────────────────────────────────
  for (const c of [foundation, elite]) {
    const modCount = await CourseModule.countDocuments({ course: c._id });
    const chapCount = await Chapter.countDocuments({ course: c._id });
    console.log(`  "${c.title}" (${c._id}) — ${modCount} modules, ${chapCount} chapters, thumbnail ${Math.round(c.thumbnailUrl.length / 1024)}KB`);
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
