/* eslint-disable no-console */
// One-off, idempotent import of the python-test-platform reference project's
// historical Postgres data into this CRM's Mongo lmsDb (Assessment* models —
// see backend/src/models/appModels/lms/assessments/).
//
//   node scripts/assessmentsImport.cjs             # apply
//   node scripts/assessmentsImport.cjs --dry-run   # parse + report only, write nothing
//
// There's no Postgres available to query directly (the source Neon DB may not
// even be reachable from here), so this hand-parses the plain-text pg_dump-style
// INSERT statements in scripts/data/python-test-platform-backup-20260917.sql
// with a small state-machine tokenizer (tracks quoted-string boundaries,
// unescapes '' -> ', strips trailing ::jsonb/::"Type" casts). Column order is
// read directly from each INSERT's own column list, not assumed.
//
// Only the tables that some already-shipped UI actually reads are imported:
// Question, TestAttempt, AttemptQuestion, CurriculumSession, DeliveryRecord.
// User rows are parsed only to build an in-memory id -> {name,email,batch} map
// used to denormalize candidate fields onto AssessmentAttempt (this CRM has
// its own Admin/Student auth, not the reference project's User table).
// ProctorEvent, RoundRobinCursor and _prisma_migrations are intentionally
// skipped (see plan doc).

require('module-alias/register');
const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const DRY = process.argv.includes('--dry-run') || process.argv.includes('-n');
const DUMP_PATH = path.join(__dirname, 'data', 'python-test-platform-backup-20260917.sql');

// ── tiny SQL-values tokenizer ────────────────────────────────────────────

// Splits a raw VALUES-tuple's inner text on top-level commas, respecting
// single-quoted strings (with '' as an escaped quote) so commas/parens
// embedded in string literals (JSON arrays, submitted Python code) don't
// break the split.
function splitTopLevel(str) {
  const parts = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inString) {
      if (c === "'") {
        if (str[i + 1] === "'") {
          current += "''";
          i++;
          continue;
        }
        inString = false;
        current += c;
        continue;
      }
      current += c;
      continue;
    }
    if (c === "'") {
      inString = true;
      current += c;
      continue;
    }
    if (c === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

function parseValue(raw) {
  const token = raw.trim();
  if (token === 'NULL') return null;
  if (token === 'TRUE') return true;
  if (token === 'FALSE') return false;
  if (token.startsWith("'")) {
    let out = '';
    let j = 1;
    while (j < token.length) {
      if (token[j] === "'") {
        if (token[j + 1] === "'") {
          out += "'";
          j += 2;
          continue;
        }
        break; // closing quote — ignore any trailing ::cast
      }
      out += token[j];
      j++;
    }
    return out;
  }
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  return token;
}

// Finds every `INSERT INTO "tableName" (...) VALUES (...);` statement for the
// given table and returns each row as a { columnName: parsedValue } object.
function parseInsertsForTable(sql, tableName) {
  const marker = `INSERT INTO "${tableName}" (`;
  const rows = [];
  let idx = 0;

  while (true) {
    const start = sql.indexOf(marker, idx);
    if (start === -1) break;

    const colListStart = start + marker.length;
    const colListEnd = sql.indexOf(')', colListStart);
    const columns = sql
      .slice(colListStart, colListEnd)
      .split(',')
      .map((s) => s.trim().replace(/^"|"$/g, ''));

    const valuesKwIdx = sql.indexOf('VALUES', colListEnd);
    const tupleStart = sql.indexOf('(', valuesKwIdx);

    let i = tupleStart + 1;
    let inString = false;
    while (i < sql.length) {
      const c = sql[i];
      if (inString) {
        if (c === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          inString = false;
        }
        i++;
        continue;
      }
      if (c === "'") {
        inString = true;
        i++;
        continue;
      }
      if (c === ')') break;
      i++;
    }
    const tupleEnd = i;

    const values = splitTopLevel(sql.slice(tupleStart + 1, tupleEnd)).map(parseValue);
    const row = {};
    columns.forEach((col, colIdx) => {
      row[col] = values[colIdx];
    });
    rows.push(row);

    idx = tupleEnd + 1;
  }

  return rows;
}

// ── main ─────────────────────────────────────────────────────────────────

(async () => {
  if (!fs.existsSync(DUMP_PATH)) {
    console.error(`Dump not found at ${DUMP_PATH}`);
    process.exit(1);
  }
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set (backend/.env). Aborting.');
    process.exit(1);
  }

  const sql = fs.readFileSync(DUMP_PATH, 'utf-8');

  console.log('Parsing dump...');
  const users = parseInsertsForTable(sql, 'User');
  const questions = parseInsertsForTable(sql, 'Question');
  const testAttempts = parseInsertsForTable(sql, 'TestAttempt');
  const attemptQuestions = parseInsertsForTable(sql, 'AttemptQuestion');
  const curriculumSessions = parseInsertsForTable(sql, 'CurriculumSession');
  const deliveryRecords = parseInsertsForTable(sql, 'DeliveryRecord');

  console.log(
    `Parsed: User=${users.length} Question=${questions.length} TestAttempt=${testAttempts.length} ` +
      `AttemptQuestion=${attemptQuestions.length} CurriculumSession=${curriculumSessions.length} ` +
      `DeliveryRecord=${deliveryRecords.length}`
  );

  const userById = new Map(users.map((u) => [u.id, u]));

  const questionDocs = questions.map((q) => ({
    _id: q.id,
    topic: q.topic,
    text: q.text,
    questionType: q.questionType,
    options: q.options ? JSON.parse(q.options) : undefined,
    correctOption: q.correctOption,
    expectedOutput: q.expectedOutput,
    starterCode: q.starterCode,
    type: q.type,
    difficulty: q.difficulty,
    partOrder: q.partOrder,
    retired: q.retired,
    createdAt: q.createdAt ? new Date(q.createdAt) : new Date(),
  }));

  const attemptDocs = testAttempts.map((a) => {
    const user = userById.get(a.userId);
    return {
      _id: a.id,
      testType: a.testType,
      status: a.status,
      score: a.score,
      totalCount: a.totalCount,
      warningCount: a.warningCount,
      startedAt: a.startedAt ? new Date(a.startedAt) : new Date(),
      submittedAt: a.submittedAt ? new Date(a.submittedAt) : null,
      candidate: null, // no matching CRM Admin account for historical rows
      candidateName: user ? user.name : null,
      candidateEmail: user ? user.email : null,
      candidateBatch: user ? user.batch : null,
    };
  });

  const attemptQuestionDocs = attemptQuestions.map((aq) => ({
    _id: aq.id,
    attemptId: aq.attemptId,
    questionId: aq.questionId,
    order: aq.order,
    selectedOption: aq.selectedOption,
    submittedCode: aq.submittedCode,
    isCorrect: aq.isCorrect,
  }));

  const curriculumSessionDocs = curriculumSessions.map((s) => ({
    _id: s.id,
    code: s.code,
    unit: s.unit,
    title: s.title,
    hours: s.hours,
    order: s.order,
    track: s.track,
    createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
  }));

  const deliveryRecordDocs = deliveryRecords.map((r) => ({
    _id: r.id,
    sessionId: r.sessionId,
    batch: r.batch,
    status: r.status,
    plannedDate: r.plannedDate ? new Date(r.plannedDate) : null,
    actualDate: r.actualDate ? new Date(r.actualDate) : null,
    notes: r.notes,
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
  }));

  if (DRY) {
    console.log('(DRY RUN — no writes)');
    console.log(`Would upsert: AssessmentQuestion=${questionDocs.length} AssessmentAttempt=${attemptDocs.length} ` +
      `AssessmentAttemptQuestion=${attemptQuestionDocs.length} AssessmentCurriculumSession=${curriculumSessionDocs.length} ` +
      `AssessmentDeliveryRecord=${deliveryRecordDocs.length}`);
    process.exit(0);
  }

  // exact bootstrap order server.js uses: connect -> install multi-db
  // routing -> THEN glob-require every model file (registration must happen
  // after the routing patch is installed, or models bind to the wrong db).
  await mongoose.connect(process.env.DATABASE, { serverSelectionTimeoutMS: 10000 });
  require('../src/config/multiDb').installMultiDbRouting();
  console.log(`connected: ${mongoose.connection.name}`);

  const modelGlob = path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(path.sep).join('/');
  globSync(modelGlob).forEach((f) => require(f));

  async function upsertAll(Model, docs) {
    if (!docs.length) return;
    const ops = docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $set: doc }, upsert: true },
    }));
    const result = await Model.bulkWrite(ops, { ordered: false });
    console.log(
      `${Model.modelName}: matched=${result.matchedCount} upserted=${result.upsertedCount} modified=${result.modifiedCount}`
    );
  }

  await upsertAll(mongoose.model('AssessmentQuestion'), questionDocs);
  await upsertAll(mongoose.model('AssessmentCurriculumSession'), curriculumSessionDocs);
  await upsertAll(mongoose.model('AssessmentDeliveryRecord'), deliveryRecordDocs);
  await upsertAll(mongoose.model('AssessmentAttempt'), attemptDocs);
  await upsertAll(mongoose.model('AssessmentAttemptQuestion'), attemptQuestionDocs);

  console.log('Done.');
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
