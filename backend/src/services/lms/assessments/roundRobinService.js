const mongoose = require('mongoose');

// Ported from python-test-platform's src/services/roundRobinService.js
// (Prisma/Postgres -> Mongoose). Same algorithm: MICRO/NLP_MICRO pull a fixed,
// hand-ordered set of questions; BASIC/MAJOR/NLP_MAJOR cycle through each
// question-type pool via a persistent cursor so repeat test-takers see a
// rotating set rather than always the same first N questions.

const TYPE_MIX = {
  BASIC: { MCQ: 20, OUTPUT_BASED: 20, PROGRAMMING: 10 },
  MAJOR: { MCQ: 15, OUTPUT_BASED: 20, PROGRAMMING: 15 },
  NLP_MAJOR: { MCQ: 30, OUTPUT_BASED: 15, PROGRAMMING: 5 },
};

async function pickFromPool(testType, questionType, count) {
  const AssessmentQuestion = mongoose.model('AssessmentQuestion');
  const AssessmentRoundRobinCursor = mongoose.model('AssessmentRoundRobinCursor');

  const totalAvailable = await AssessmentQuestion.countDocuments({
    type: testType,
    questionType,
    retired: false,
  });

  if (totalAvailable < count) {
    throw new Error(
      `Not enough ${questionType} questions for ${testType} test. Need ${count}, have ${totalAvailable}.`
    );
  }

  const cursorId = `${testType}_${questionType}`;

  // Atomic equivalent of the reference's raw
  // `INSERT ... ON CONFLICT ... RETURNING cursor` — findOneAndUpdate with
  // upsert + $inc is atomic per-document in MongoDB.
  const updated = await AssessmentRoundRobinCursor.findOneAndUpdate(
    { _id: cursorId },
    { $inc: { cursor: count }, $setOnInsert: { testType, questionType } },
    { upsert: true, new: true }
  );

  const newCursor = updated.cursor;
  const startOffset = (newCursor - count) % totalAvailable;

  const pool = await AssessmentQuestion.find({ type: testType, questionType, retired: false })
    .sort({ createdAt: 1 })
    .lean();

  const selected = [];
  for (let i = 0; i < count; i++) {
    const idx = (startOffset + i) % totalAvailable;
    selected.push(pool[idx]);
  }

  return selected;
}

async function getFixedQuestions(testType) {
  const AssessmentQuestion = mongoose.model('AssessmentQuestion');
  return AssessmentQuestion.find({ type: testType }).sort({ partOrder: 1 }).lean();
}

async function assignQuestions(testType) {
  if (testType === 'MICRO' || testType === 'NLP_MICRO') {
    return getFixedQuestions(testType);
  }

  const mix = TYPE_MIX[testType];
  if (!mix) {
    throw new Error(`Unknown test type: ${testType}`);
  }

  const allSelected = [];
  for (const [questionType, count] of Object.entries(mix)) {
    const picked = await pickFromPool(testType, questionType, count);
    allSelected.push(...picked);
  }

  for (let i = allSelected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allSelected[i], allSelected[j]] = [allSelected[j], allSelected[i]];
  }

  return allSelected;
}

module.exports = { assignQuestions };
