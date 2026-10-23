const crypto = require('crypto');
const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES } = require('../../../../../config/roles');
const { TYPE_MIX } = require('../../../../../services/lms/assessments/roundRobinService');
const { runPythonCode, normalizeOutput } = require('../../../../../services/lms/assessments/codeExecutionService');

// LMS → Question Bank: Admin / Support / Teacher upload a JSON file of test
// questions, pick which test it goes into, preview + validate (duplicates,
// missing answers, optional answer check by actually running the code), tick
// the ones to keep and import. Plus a list of each test's questions with
// retire / restore. The test runner (roundRobinService) is untouched — it
// just sees a bigger pool.

const TESTS = [
  { key: 'BASIC', label: 'Basic Test' },
  { key: 'MAJOR', label: 'Major — Python Programming Foundations & SQL Basics' },
  { key: 'NLP_MAJOR', label: 'Major — NLP Fundamentals & Introduction to LLMs' },
  { key: 'LLM_MAJOR', label: 'Major — LLM APIs & Prompt Engineering' },
  { key: 'MICRO', label: 'Micro — SQL-Backed Keyword Database' },
  { key: 'NLP_MICRO', label: 'Micro — NLP on a SERP Dataset' },
];
const TEST_KEYS = TESTS.map((t) => t.key);
const FIXED_SET = ['MICRO', 'NLP_MICRO']; // every question is served, in partOrder
const QTYPES = ['MCQ', 'OUTPUT_BASED', 'PROGRAMMING'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const MAX_ROWS = 500;

const ALLOWED = [...LMS_FULL_ACCESS_ROLES, 'Teacher'];
const guard = (req, res) => {
  if (ALLOWED.includes(req.admin && req.admin.role)) return true;
  res.status(403).json({ success: false, result: null, message: 'Question Bank is for Admin, Support and Teachers.' });
  return false;
};
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, message, code = 400) => res.status(code).json({ success: false, result: null, message });
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const str = (v) => (v == null ? '' : String(v));

// One raw JSON row → { q, errors[], warnings[] }. Accepts the same shape the
// existing banks use (topic, text, questionType, options, correctOption,
// starterCode, expectedOutput, difficulty, retired, partOrder) and a few
// forgiving aliases (question/type/answer).
function normalize(raw) {
  const errors = [];
  const warnings = [];
  const r = raw && typeof raw === 'object' ? raw : {};
  const questionType = str(r.questionType || r.kind).toUpperCase().replace(/[\s-]+/g, '_').replace(/^OUTPUT$/, 'OUTPUT_BASED');
  const q = {
    topic: str(r.topic).trim(),
    text: str(r.text || r.question).trim(),
    questionType,
    options: Array.isArray(r.options) ? r.options.map((o) => str(o)) : [],
    correctOption: r.correctOption == null || r.correctOption === '' ? null : Number(r.correctOption),
    starterCode: r.starterCode == null ? '' : str(r.starterCode),
    expectedOutput: r.expectedOutput == null ? '' : str(r.expectedOutput),
    difficulty: DIFFICULTIES.includes(str(r.difficulty).toLowerCase()) ? str(r.difficulty).toLowerCase() : 'hard',
    partOrder: Number.isFinite(Number(r.partOrder)) ? Number(r.partOrder) : 0,
    retired: !!r.retired,
  };
  if (!q.topic) errors.push('Topic is missing.');
  if (!q.text) errors.push('Question text is missing.');
  if (!QTYPES.includes(q.questionType)) errors.push(`questionType must be MCQ, OUTPUT_BASED or PROGRAMMING (got "${str(r.questionType)}").`);
  if (q.questionType === 'MCQ' || q.questionType === 'OUTPUT_BASED') {
    if (q.options.length < 2) errors.push('Needs at least 2 options.');
    if (q.options.some((o) => !o.trim())) errors.push('An option is empty.');
    if (new Set(q.options.map(norm)).size !== q.options.length) warnings.push('Two options are the same.');
    if (!Number.isInteger(q.correctOption) || q.correctOption < 0 || q.correctOption >= q.options.length) {
      errors.push(`correctOption must be 0–${Math.max(0, q.options.length - 1)} (the index of the right option).`);
    }
  }
  if (q.questionType === 'PROGRAMMING') {
    if (!q.expectedOutput.trim()) errors.push('Programming question needs expectedOutput.');
    if (!q.starterCode.trim()) warnings.push('No starterCode — candidates start from an empty editor.');
  }
  if (raw && raw.type && !TEST_KEYS.includes(str(raw.type))) warnings.push(`"type": "${raw.type}" in the file is ignored — the test you pick is used.`);
  return { q, errors, warnings };
}

async function poolStats(testType) {
  const rows = await mongoose
    .model('AssessmentQuestion')
    .aggregate([{ $match: { type: testType } }, { $group: { _id: { t: '$questionType', r: '$retired' }, n: { $sum: 1 } } }]);
  const by = {};
  for (const q of QTYPES) by[q] = { active: 0, retired: 0, needed: (TYPE_MIX[testType] || {})[q] || 0 };
  for (const r of rows) if (by[r._id.t]) by[r._id.t][r._id.r ? 'retired' : 'active'] += r.n;
  return by;
}

// GET /lms/assessments/bank/tests
async function tests(req, res) {
  if (!guard(req, res)) return;
  const out = [];
  for (const t of TESTS) {
    const pool = await poolStats(t.key);
    out.push({
      ...t,
      fixedSet: FIXED_SET.includes(t.key),
      perAttempt: TYPE_MIX[t.key] || null,
      pool,
      total: QTYPES.reduce((a, k) => a + pool[k].active, 0),
    });
  }
  return ok(res, out);
}

// POST /lms/assessments/bank/preview { testType, questions: [...] }
async function preview(req, res) {
  if (!guard(req, res)) return;
  const { testType, questions } = req.body || {};
  if (!TEST_KEYS.includes(testType)) return bad(res, 'Pick which test these questions are for.');
  if (!Array.isArray(questions) || !questions.length) return bad(res, 'The file has no questions — it must be a JSON array.');
  if (questions.length > MAX_ROWS) return bad(res, `At most ${MAX_ROWS} questions per upload.`);

  const existing = await mongoose.model('AssessmentQuestion').find({ type: testType }).select('text').lean();
  const have = new Set(existing.map((e) => norm(e.text)));
  const seen = new Map();
  const rows = questions.map((raw, i) => {
    const { q, errors, warnings } = normalize(raw);
    const k = norm(q.text);
    let duplicate = null;
    if (k && have.has(k)) duplicate = 'Already in this test';
    else if (k && seen.has(k)) duplicate = `Same as #${seen.get(k) + 1} in this file`;
    if (k && !seen.has(k)) seen.set(k, i);
    return { index: i, ...q, errors, warnings, duplicate, importable: !errors.length && !duplicate };
  });
  const count = (f) => rows.filter(f).length;
  return ok(res, {
    testType,
    rows,
    summary: {
      total: rows.length,
      importable: count((r) => r.importable),
      errors: count((r) => r.errors.length),
      duplicates: count((r) => r.duplicate),
      byType: QTYPES.reduce((m, t) => ({ ...m, [t]: count((r) => r.questionType === t && r.importable) }), {}),
    },
    pool: await poolStats(testType),
  });
}

// POST /lms/assessments/bank/check { questions: [...] } — run each
// OUTPUT_BASED snippet / PROGRAMMING reference and compare with the answer key.
// OUTPUT_BASED: code is the part of the text after the first blank line.
async function check(req, res) {
  if (!guard(req, res)) return;
  const list = Array.isArray((req.body || {}).questions) ? req.body.questions.slice(0, 60) : [];
  const out = [];
  for (const raw of list) {
    const { q } = normalize(raw);
    if (q.questionType !== 'OUTPUT_BASED') {
      out.push({ index: raw.index, status: 'skipped' });
      continue;
    }
    const code = q.text.split(/\n\s*\n/).slice(1).join('\n\n');
    if (!code.trim()) {
      out.push({ index: raw.index, status: 'no-code' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const r = await runPythonCode(code);
    const got = normalizeOutput(r.success ? r.output : (r.error || '').split('\n').filter(Boolean).pop() || '');
    const key = normalizeOutput(q.options[q.correctOption]);
    const pass = got === key || (/Error/.test(key) && got.startsWith(key.split(':')[0]));
    out.push({ index: raw.index, status: r.success || /Error/.test(key) ? (pass ? 'ok' : 'mismatch') : 'error', got, expected: key, error: r.success ? undefined : r.error });
  }
  return ok(res, out);
}

// POST /lms/assessments/bank/import { testType, questions: [...] }
async function importQuestions(req, res) {
  if (!guard(req, res)) return;
  const { testType, questions } = req.body || {};
  if (!TEST_KEYS.includes(testType)) return bad(res, 'Pick which test these questions are for.');
  if (!Array.isArray(questions) || !questions.length) return bad(res, 'Select at least one question.');
  if (questions.length > MAX_ROWS) return bad(res, `At most ${MAX_ROWS} questions per import.`);
  const Q = mongoose.model('AssessmentQuestion');
  const existing = new Set((await Q.find({ type: testType }).select('text').lean()).map((e) => norm(e.text)));
  const docs = [];
  let skipped = 0;
  let invalid = 0;
  for (const raw of questions) {
    const { q, errors } = normalize(raw);
    if (errors.length) {
      invalid += 1;
      continue;
    }
    const k = norm(q.text);
    if (existing.has(k)) {
      skipped += 1;
      continue;
    }
    existing.add(k);
    const objective = q.questionType !== 'PROGRAMMING';
    docs.push({
      _id: crypto.randomUUID(),
      topic: q.topic,
      text: q.text,
      questionType: q.questionType,
      options: objective ? q.options : undefined,
      correctOption: objective ? q.correctOption : undefined,
      starterCode: q.starterCode || undefined,
      expectedOutput: q.expectedOutput || undefined,
      type: testType,
      difficulty: q.difficulty,
      partOrder: q.partOrder,
      retired: q.retired,
    });
  }
  if (docs.length) await Q.insertMany(docs);
  mongoose
    .model('AuditLog')
    .create({
      module: 'assessment',
      action: 'questions.import',
      entityType: 'AssessmentQuestion',
      performedBy: req.admin._id,
      performedByName: `${req.admin.name || ''} ${req.admin.surname || ''}`.trim(),
      performedByRole: req.admin.role,
      after: { testType, added: docs.length, skipped, invalid },
    })
    .catch(() => {});
  const label = (TESTS.find((t) => t.key === testType) || {}).label || testType;
  return ok(
    res,
    { added: docs.length, skipped, invalid, pool: await poolStats(testType) },
    `${docs.length} question${docs.length === 1 ? '' : 's'} added to ${label}${skipped ? ` · ${skipped} already there` : ''}${invalid ? ` · ${invalid} invalid skipped` : ''}.`
  );
}

// GET /lms/assessments/bank/questions?testType=&q=&questionType=&status=active|retired
async function list(req, res) {
  if (!guard(req, res)) return;
  const { testType, q, questionType, status } = req.query;
  if (!TEST_KEYS.includes(testType)) return bad(res, 'Pick a test.');
  const filter = { type: testType };
  if (QTYPES.includes(questionType)) filter.questionType = questionType;
  if (status === 'active') filter.retired = false;
  if (status === 'retired') filter.retired = true;
  if (q && String(q).trim()) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ text: rx }, { topic: rx }];
  }
  const rows = await mongoose.model('AssessmentQuestion').find(filter).sort({ createdAt: -1 }).limit(1000).lean();
  return ok(res, rows.map((r) => ({ ...r, id: r._id })));
}

// PATCH /lms/assessments/bank/questions/:id { retired }
async function setRetired(req, res) {
  if (!guard(req, res)) return;
  const Q = mongoose.model('AssessmentQuestion');
  const doc = await Q.findById(req.params.id);
  if (!doc) return bad(res, 'Question not found.', 404);
  const retire = !!(req.body || {}).retired;
  if (retire && !doc.retired && TYPE_MIX[doc.type]) {
    // never retire below what one attempt needs
    const left = await Q.countDocuments({ type: doc.type, questionType: doc.questionType, retired: false });
    const need = TYPE_MIX[doc.type][doc.questionType] || 0;
    if (left - 1 < need) return bad(res, `Can't retire — this test needs ${need} active ${doc.questionType} questions per attempt and only ${left} are active.`);
  }
  doc.retired = retire;
  await doc.save();
  return ok(res, { id: doc._id, retired: doc.retired }, retire ? 'Question retired — new attempts won\'t get it.' : 'Question restored.');
}

module.exports = { tests, preview, check, importQuestions, list, setRetired };
