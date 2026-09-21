const mongoose = require('mongoose');

// Ported from python-test-platform's src/controllers/adminController.js
// (Prisma -> Mongoose). Filtering/searching is simpler than the reference
// version because candidate name/email/batch are denormalized directly onto
// AssessmentAttempt (see that model's comment) instead of living on a
// separate User table that would need a relational filter.

const QUALIFY_THRESHOLD = 0.9;

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

    let results = attempts.map((a) => {
      const qual = a.status === 'SUBMITTED' && a.totalCount ? a.score / a.totalCount >= QUALIFY_THRESHOLD : null;
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
      AssessmentAttempt.find({ status: 'SUBMITTED' }).select('score totalCount').lean(),
    ]);

    const avgScorePct =
      submittedAttempts.length > 0
        ? (submittedAttempts.reduce((sum, a) => sum + a.score / a.totalCount, 0) / submittedAttempts.length) * 100
        : 0;

    const qualifiedCount = submittedAttempts.filter((a) => a.score / a.totalCount >= QUALIFY_THRESHOLD).length;

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

module.exports = { getAttempts, getAttemptReport, getSummary };
