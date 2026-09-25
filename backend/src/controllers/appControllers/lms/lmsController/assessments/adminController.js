const mongoose = require('mongoose');
const assessmentSettings = require('../../../../../services/lms/assessmentSettingsService');

// Ported from python-test-platform's src/controllers/adminController.js
// (Prisma -> Mongoose). Filtering/searching is simpler than the reference
// version because candidate name/email/batch are denormalized directly onto
// AssessmentAttempt (see that model's comment) instead of living on a
// separate User table that would need a relational filter.
//
// qualifyThreshold now comes from assessmentSettingsService (admin-
// configurable) instead of a hardcoded constant independently duplicated
// here and in testController.js.

async function getAttempts(req, res) {
  try {
    const {
      testType,
      status,
      qualified,
      attemptNumber,
      minScore,
      maxScore,
      search,
      batch,
      startDate,
      endDate,
      sortBy = 'startedAt',
      sortOrder = 'desc',
      page = '1',
      pageSize = '25',
    } = req.query;

    const AssessmentAttempt = mongoose.model('AssessmentAttempt');

    const where = {};
    if (testType) where.testType = testType;
    if (status) where.status = status;
    if (startDate || endDate) {
      where.startedAt = {};
      if (startDate) where.startedAt.$gte = new Date(startDate);
      if (endDate) where.startedAt.$lte = new Date(endDate);
    }
    if (minScore !== undefined || maxScore !== undefined) {
      where.score = {};
      if (minScore !== undefined) where.score.$gte = Number(minScore);
      if (maxScore !== undefined) where.score.$lte = Number(maxScore);
    }
    if (batch) where.candidateBatch = batch;
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      where.$or = [{ candidateName: re }, { candidateEmail: re }];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25));

    const validSortFields = ['startedAt', 'submittedAt', 'score'];
    const orderField = validSortFields.includes(sortBy) ? sortBy : 'startedAt';
    const orderDir = sortOrder === 'asc' ? 1 : -1;

    const [attempts, total] = await Promise.all([
      AssessmentAttempt.find(where)
        .sort({ [orderField]: orderDir, _id: 1 })
        .skip((pageNum - 1) * pageSizeNum)
        .limit(pageSizeNum)
        .lean(),
      AssessmentAttempt.countDocuments(where),
    ]);

    // Attempt number isn't a stored field: rank each candidate's attempts of
    // the same test type chronologically (1st, 2nd, 3rd...) across ALL their
    // attempts of that type, not just the current filtered/paginated page.
    const candidateEmails = [...new Set(attempts.map((a) => a.candidateEmail).filter(Boolean))];
    const allAttemptsForNumbering = await AssessmentAttempt.find({ candidateEmail: { $in: candidateEmails } })
      .select('candidateEmail testType startedAt')
      .sort({ startedAt: 1 })
      .lean();
    const groupCounters = {};
    const attemptNumberMap = new Map();
    for (const a of allAttemptsForNumbering) {
      const key = `${a.candidateEmail}:${a.testType}`;
      groupCounters[key] = (groupCounters[key] || 0) + 1;
      attemptNumberMap.set(String(a._id), groupCounters[key]);
    }

    const { qualifyThreshold } = await assessmentSettings.get();
    let results = attempts.map((a) => {
      const qual =
        a.qualified !== undefined && a.qualified !== null
          ? a.qualified
          : a.status === 'SUBMITTED' && a.totalCount
          ? a.score / a.totalCount >= qualifyThreshold
          : null;
      return {
        attemptId: a._id,
        studentName: a.candidateName,
        studentEmail: a.candidateEmail,
        studentBatch: a.candidateBatch,
        testType: a.testType,
        status: a.status,
        score: a.score,
        totalCount: a.totalCount,
        warningCount: a.warningCount,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        qualified: qual,
        attemptNumber: attemptNumberMap.get(String(a._id)) || null,
      };
    });

    if (qualified !== undefined) {
      const wantQualified = qualified === 'true';
      results = results.filter((r) => r.qualified === wantQualified);
    }
    if (attemptNumber !== undefined) {
      results = results.filter((r) => r.attemptNumber === Number(attemptNumber));
    }

    return res.status(200).json({
      success: true,
      result: { results, pagination: { page: pageNum, pageSize: pageSizeNum, total } },
    });
  } catch (err) {
    console.error('Admin get assessment attempts error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

// GET /api/lms/assessments/admin/attempts/export?format=csv|xlsx&testType=&batch=&status=
// Spec §16 "Assessment attempt/result report" — getAttempts above is JSON +
// paginated (the frontend only ever CSV-exports the current page client-
// side); this exports every matching row server-side, same shape as the
// attendance/learner-360/policy-ack exports.
async function getAttemptsExport(req, res) {
  const { testType, status, batch, qualified } = req.query;
  const AssessmentAttempt = mongoose.model('AssessmentAttempt');
  const where = {};
  if (testType) where.testType = testType;
  if (status) where.status = status;
  if (batch) where.candidateBatch = batch;

  const { qualifyThreshold } = await assessmentSettings.get();
  const rows = await AssessmentAttempt.find(where).sort({ startedAt: -1 }).limit(5000).lean();
  let outRows = rows.map((a) => ({
    student: a.candidateName,
    email: a.candidateEmail,
    batch: a.candidateBatch,
    testType: a.testType,
    status: a.status,
    score: a.score,
    totalCount: a.totalCount,
    qualified:
      a.qualified !== undefined && a.qualified !== null
        ? a.qualified
        : a.status === 'SUBMITTED' && a.totalCount
        ? a.score / a.totalCount >= qualifyThreshold
        : null,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
  }));
  if (qualified !== undefined) {
    const want = qualified === 'true';
    outRows = outRows.filter((r) => r.qualified === want);
  }

  const format = String(req.query.format || 'csv').toLowerCase();
  const headers = ['Student', 'Email', 'Batch', 'Test Type', 'Status', 'Score', 'Total', 'Qualified', 'Started', 'Submitted'];
  const line = (r) =>
    [r.student, r.email, r.batch, r.testType, r.status, r.score, r.totalCount, r.qualified, r.startedAt ? new Date(r.startedAt).toISOString() : '', r.submittedAt ? new Date(r.submittedAt).toISOString() : '']
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');

  if (format === 'xlsx') {
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(outRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Assessment Attempts');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="assessment-attempts.xlsx"');
      return res.status(200).send(buf);
    } catch (e) {
      // fall through to csv
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="assessment-attempts.csv"');
  return res.status(200).send([headers.join(','), ...outRows.map(line)].join('\n'));
}

// GET /api/lms/assessments/admin/not-attempted?testType=&batch= — manager
// only. Spec §16 "Disqualified/qualified/pending/NOT-ATTEMPTED report" — the
// existing report only ever lists rows for attempts that exist; it never
// cross-references the roster to find students who never started at all.
async function notAttemptedReport(req, res) {
  const { testType, batch } = req.query;
  if (!testType) return res.status(400).json({ success: false, message: 'testType is required.' });

  const Student = mongoose.model('Student');
  const AssessmentAttempt = mongoose.model('AssessmentAttempt');
  const rosterQuery = { removed: false, status: 'Active' };
  if (batch) rosterQuery.batch = batch;
  const roster = await Student.find(rosterQuery).select('name email batch').lean();

  const attempted = await AssessmentAttempt.find({ testType, candidateEmail: { $in: roster.map((r) => r.email) } })
    .select('candidateEmail')
    .lean();
  const attemptedEmails = new Set(attempted.map((a) => (a.candidateEmail || '').toLowerCase()));
  const notAttempted = roster.filter((r) => r.email && !attemptedEmails.has(r.email.toLowerCase()));

  return res.status(200).json({
    success: true,
    result: { testType, totalRoster: roster.length, notAttemptedCount: notAttempted.length, rows: notAttempted },
  });
}

async function getAttemptReport(req, res) {
  try {
    const { attemptId } = req.params;
    const AssessmentAttempt = mongoose.model('AssessmentAttempt');
    const AssessmentAttemptQuestion = mongoose.model('AssessmentAttemptQuestion');
    const AssessmentQuestion = mongoose.model('AssessmentQuestion');

    const attempt = await AssessmentAttempt.findById(attemptId).lean();
    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }

    const attemptQuestions = await AssessmentAttemptQuestion.find({ attemptId }).lean();
    const questions = await AssessmentQuestion.find({
      _id: { $in: attemptQuestions.map((aq) => aq.questionId) },
    }).lean();
    const questionById = new Map(questions.map((q) => [String(q._id), q]));

    const topicMap = {};
    for (const aq of attemptQuestions) {
      const topic = questionById.get(String(aq.questionId))?.topic;
      if (!topicMap[topic]) topicMap[topic] = { topic, correct: 0, incorrect: 0, ungraded: 0 };
      if (aq.isCorrect === true) topicMap[topic].correct++;
      else if (aq.isCorrect === false) topicMap[topic].incorrect++;
      else topicMap[topic].ungraded++;
    }
    const breakdown = Object.values(topicMap).sort((a, b) => a.topic.localeCompare(b.topic));

    return res.status(200).json({
      success: true,
      result: {
        attemptId: attempt._id,
        student: { id: attempt.candidate, name: attempt.candidateName, email: attempt.candidateEmail },
        testType: attempt.testType,
        status: attempt.status,
        score: attempt.score,
        totalCount: attempt.totalCount,
        warningCount: attempt.warningCount,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        breakdown,
        questions: attemptQuestions
          .sort((a, b) => a.order - b.order)
          .map((aq) => {
            const q = questionById.get(String(aq.questionId));
            return {
              attemptQuestionId: aq._id,
              topic: q?.topic,
              questionType: q?.questionType,
              text: q?.text,
              isCorrect: aq.isCorrect,
              selectedOption: aq.selectedOption,
              submittedCode: aq.submittedCode,
            };
          }),
      },
    });
  } catch (err) {
    console.error('Admin get assessment attempt report error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

async function getSummary(req, res) {
  try {
    const AssessmentAttempt = mongoose.model('AssessmentAttempt');
    const AssessmentAttemptQuestion = mongoose.model('AssessmentAttemptQuestion');
    const AssessmentQuestion = mongoose.model('AssessmentQuestion');

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalAttempts, todayCount, weekCount, submittedAttempts] = await Promise.all([
      AssessmentAttempt.countDocuments(),
      AssessmentAttempt.countDocuments({ startedAt: { $gte: todayStart } }),
      AssessmentAttempt.countDocuments({ startedAt: { $gte: weekStart } }),
      AssessmentAttempt.find({ status: 'SUBMITTED' }).select('score totalCount qualified').lean(),
    ]);

    const avgScorePct =
      submittedAttempts.length > 0
        ? (submittedAttempts.reduce((sum, a) => sum + a.score / a.totalCount, 0) / submittedAttempts.length) * 100
        : 0;

    const { qualifyThreshold } = await assessmentSettings.get();
    const qualifiedCount = submittedAttempts.filter((a) =>
      a.qualified !== undefined && a.qualified !== null ? a.qualified : a.score / a.totalCount >= qualifyThreshold
    ).length;

    const wrongAttemptQuestions = await AssessmentAttemptQuestion.find({ isCorrect: false }).select('questionId').lean();
    const wrongQuestions = await AssessmentQuestion.find({
      _id: { $in: wrongAttemptQuestions.map((aq) => aq.questionId) },
    })
      .select('topic')
      .lean();
    const topicById = new Map(wrongQuestions.map((q) => [String(q._id), q.topic]));
    const topicWrongCounts = {};
    for (const aq of wrongAttemptQuestions) {
      const t = topicById.get(String(aq.questionId));
      if (!t) continue;
      topicWrongCounts[t] = (topicWrongCounts[t] || 0) + 1;
    }
    const mostStruggledTopic = Object.entries(topicWrongCounts).sort((a, b) => b[1] - a[1])[0];

    return res.status(200).json({
      success: true,
      result: {
        totalAttempts,
        attemptsToday: todayCount,
        attemptsThisWeek: weekCount,
        averageScorePercent: Number(avgScorePct.toFixed(1)),
        qualifiedCount,
        submittedCount: submittedAttempts.length,
        qualificationRate:
          submittedAttempts.length > 0 ? Number(((qualifiedCount / submittedAttempts.length) * 100).toFixed(1)) : 0,
        mostStruggledTopic: mostStruggledTopic ? { topic: mostStruggledTopic[0], wrongCount: mostStruggledTopic[1] } : null,
      },
    });
  } catch (err) {
    console.error('Admin get assessment summary error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

// POST /api/lms/assessments/admin/attempts/:attemptId/correct — manager only.
// Spec §9 "Manual review and result correction must require authorization
// and an audit trail" — mirrors liveScope.js#correctAttendanceHandler's
// shape exactly (mandatory reason, before/after AuditLog entry, on-row
// correction trace).
async function correctAttempt(req, res) {
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (!reason) return res.status(400).json({ success: false, message: 'A correction reason is required.' });
  if (b.status && !['SUBMITTED', 'SUSPENDED'].includes(b.status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }

  const AssessmentAttempt = mongoose.model('AssessmentAttempt');
  const attempt = await AssessmentAttempt.findById(req.params.attemptId);
  if (!attempt) return res.status(404).json({ success: false, message: 'Attempt not found.' });

  const before = { score: attempt.score, totalCount: attempt.totalCount, status: attempt.status, qualified: attempt.qualified };

  if (b.score !== undefined) attempt.score = Math.max(0, Number(b.score) || 0);
  if (b.totalCount !== undefined) attempt.totalCount = Math.max(1, Number(b.totalCount) || attempt.totalCount);
  if (b.status) attempt.status = b.status;
  if (b.qualified !== undefined) {
    attempt.qualified = !!b.qualified;
  } else if (b.score !== undefined || b.totalCount !== undefined) {
    // Re-derive from the (possibly just-edited) score/totalCount against the
    // CURRENT threshold, unless the admin explicitly overrode `qualified`
    // itself — same rule submitTest uses at first-submission time.
    const { qualifyThreshold } = await assessmentSettings.get();
    attempt.qualified = attempt.totalCount ? attempt.score / attempt.totalCount >= qualifyThreshold : false;
  }
  attempt.correctedBy = req.admin._id;
  attempt.correctedByName = req.admin.name;
  attempt.correctedAt = new Date();
  attempt.correctedReason = reason;
  await attempt.save();

  try {
    await require('../../../../../services/lms/auditLog').record({
      module: 'assessment',
      action: 'correct',
      entityType: 'AssessmentAttempt',
      entityId: attempt._id,
      admin: req.admin,
      reason,
      before,
      after: { score: attempt.score, totalCount: attempt.totalCount, status: attempt.status, qualified: attempt.qualified },
    });
  } catch (e) {
    /* best-effort */
  }

  return res.status(200).json({
    success: true,
    result: { attemptId: attempt._id, score: attempt.score, totalCount: attempt.totalCount, status: attempt.status, qualified: attempt.qualified },
    message: 'Attempt corrected.',
  });
}

// GET/POST /api/lms/admin/assessment-settings — manager only. Spec §10
// "not admin-configurable" — qualifyThreshold/maxAttemptsPerType/cooldownDays
// were hardcoded constants; now a single LmsSetting('assessments') row, same
// shape as liveScope.js's getSettings/updateSettings for live classes.
async function getAssessmentSettings(req, res) {
  const s = await assessmentSettings.get(true);
  return res.status(200).json({ success: true, result: s });
}
async function updateAssessmentSettings(req, res) {
  const s = await assessmentSettings.update(req.body || {});
  return res.status(200).json({ success: true, result: s });
}

module.exports = { getAttempts, getAttemptsExport, notAttemptedReport, getAttemptReport, getSummary, getAssessmentSettings, updateAssessmentSettings, correctAttempt };
