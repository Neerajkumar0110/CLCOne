const mongoose = require('mongoose');
const { assignQuestions } = require('../../../../../services/lms/assessments/roundRobinService');
const { runPythonCode, normalizeOutput } = require('../../../../../services/lms/assessments/codeExecutionService');

// Ported from python-test-platform's src/controllers/testController.js
// (Prisma -> Mongoose). Auth is the CRM's own bearer auth (req.admin), not the
// reference project's separate User/JWT — there is no role check here either,
// matching the reference (any authenticated user may start/submit/run-code).

const COOLDOWN_DAYS = 7;
const COOLDOWN_MS = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS_PER_TYPE = 3;
const QUALIFY_THRESHOLD = 0.9;
const TEST_TYPES = ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'];

// Cooldown lifts at midnight UTC on the 7th calendar day after submission, not
// at the exact submission time — so a 3pm submission doesn't require waiting
// until 3pm exactly 7 days later.
function getCooldownEnd(submittedAt) {
  return new Date(
    Date.UTC(submittedAt.getUTCFullYear(), submittedAt.getUTCMonth(), submittedAt.getUTCDate() + COOLDOWN_DAYS)
  );
}

async function startTest(req, res) {
  try {
    const { testType } = req.params;
    const admin = req.admin;

    if (!TEST_TYPES.includes(testType)) {
      return res.status(400).json({ success: false, message: 'Invalid test type.' });
    }

    const AssessmentAttempt = mongoose.model('AssessmentAttempt');
    const AssessmentAttemptQuestion = mongoose.model('AssessmentAttemptQuestion');
    const AssessmentQuestion = mongoose.model('AssessmentQuestion');
    const Student = mongoose.model('Student');

    const existing = await AssessmentAttempt.findOne({
      candidate: admin._id,
      testType,
      status: 'IN_PROGRESS',
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'You already have an in-progress attempt for this test.',
      });
    }

    const totalAttempts = await AssessmentAttempt.countDocuments({
      candidate: admin._id,
      testType,
      status: { $in: ['SUBMITTED', 'SUSPENDED'] },
    });
    if (totalAttempts >= MAX_ATTEMPTS_PER_TYPE) {
      return res.status(403).json({
        success: false,
        message: `You have used all ${MAX_ATTEMPTS_PER_TYPE} attempts for this test.`,
        attemptsUsed: totalAttempts,
        maxAttempts: MAX_ATTEMPTS_PER_TYPE,
      });
    }

    const cooldownWindowStart = new Date(Date.now() - COOLDOWN_MS);
    const recentClosedAttempt = await AssessmentAttempt.findOne({
      candidate: admin._id,
      testType,
      status: { $in: ['SUBMITTED', 'SUSPENDED'] },
      submittedAt: { $gte: cooldownWindowStart },
    }).sort({ submittedAt: -1 });

    if (recentClosedAttempt && recentClosedAttempt.submittedAt) {
      const nextEligible = getCooldownEnd(recentClosedAttempt.submittedAt);
      if (nextEligible.getTime() > Date.now()) {
        return res.status(403).json({
          success: false,
          message: `You can attempt a test again on ${nextEligible.toDateString()}.`,
          nextEligibleAt: nextEligible,
        });
      }
    }

    const questions = await assignQuestions(testType);

    const student = await Student.findOne({ email: admin.email }).select('batch').lean();

    const attempt = await AssessmentAttempt.create({
      testType,
      totalCount: questions.length,
      candidate: admin._id,
      candidateName: `${admin.name || ''} ${admin.surname || ''}`.trim(),
      candidateEmail: admin.email,
      candidateBatch: (student && student.batch) || null,
    });

    const attemptQuestions = await AssessmentAttemptQuestion.insertMany(
      questions.map((q, i) => ({ attemptId: attempt._id, questionId: q.id ?? q._id, order: i }))
    );

    const questionById = new Map(questions.map((q) => [String(q.id ?? q._id), q]));
    const safeQuestions = attemptQuestions
      .sort((a, b) => a.order - b.order)
      .map((aq) => {
        const q = questionById.get(String(aq.questionId));
        return {
          attemptQuestionId: aq._id,
          order: aq.order,
          id: q._id,
          text: q.text,
          questionType: q.questionType,
          options: q.options,
          starterCode: q.starterCode,
          topic: q.topic,
        };
      });

    return res.status(201).json({
      success: true,
      result: { attemptId: attempt._id, testType: attempt.testType, questions: safeQuestions },
    });
  } catch (err) {
    console.error('Start assessment error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

async function submitTest(req, res) {
  try {
    const { attemptId } = req.params;
    const admin = req.admin;
    const { answers } = req.body;

    const AssessmentAttempt = mongoose.model('AssessmentAttempt');
    const AssessmentAttemptQuestion = mongoose.model('AssessmentAttemptQuestion');
    const AssessmentQuestion = mongoose.model('AssessmentQuestion');

    const attempt = await AssessmentAttempt.findById(attemptId);
    if (!attempt || String(attempt.candidate) !== String(admin._id)) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }
    if (attempt.status !== 'IN_PROGRESS') {
      return res.status(409).json({ success: false, message: 'This attempt is already closed.' });
    }

    const attemptQuestions = await AssessmentAttemptQuestion.find({ attemptId });
    const questions = await AssessmentQuestion.find({
      _id: { $in: attemptQuestions.map((aq) => aq.questionId) },
    }).lean();
    const questionById = new Map(questions.map((q) => [String(q._id), q]));

    const answerMap = new Map((answers || []).map((a) => [a.attemptQuestionId, a]));

    let correctCount = 0;
    let gradableCount = 0;

    for (const aq of attemptQuestions) {
      const submitted = answerMap.get(aq._id);
      if (!submitted) continue;
      const question = questionById.get(String(aq.questionId));

      if (question.questionType === 'PROGRAMMING') {
        const code = submitted.submittedCode || '';
        let isCorrect = null;

        if (code.trim().length > 0 && question.expectedOutput != null) {
          const result = await runPythonCode(code);
          gradableCount++;
          if (result.success) {
            isCorrect = normalizeOutput(result.output) === normalizeOutput(question.expectedOutput);
            if (isCorrect) correctCount++;
          } else {
            isCorrect = false;
          }
        }

        aq.submittedCode = code || null;
        aq.isCorrect = isCorrect;
        await aq.save();
        continue;
      }

      gradableCount++;
      const isCorrect = submitted.selectedOption === question.correctOption;
      if (isCorrect) correctCount++;

      aq.selectedOption = submitted.selectedOption ?? null;
      aq.isCorrect = isCorrect;
      await aq.save();
    }

    attempt.status = 'SUBMITTED';
    attempt.score = correctCount;
    attempt.submittedAt = new Date();
    await attempt.save();

    return res.status(200).json({
      success: true,
      result: {
        attemptId: attempt._id,
        status: attempt.status,
        score: correctCount,
        gradableTotal: gradableCount,
        totalCount: attempt.totalCount,
      },
    });
  } catch (err) {
    console.error('Submit assessment error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

async function runCode(req, res) {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Code is required.' });
    }
    const result = await runPythonCode(code);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Run code error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

async function getMyResults(req, res) {
  try {
    const admin = req.admin;
    const AssessmentAttempt = mongoose.model('AssessmentAttempt');

    const attempts = await AssessmentAttempt.find({
      $or: [{ candidate: admin._id }, { candidateEmail: admin.email }],
    })
      .sort({ startedAt: -1 })
      .lean();

    const results = attempts.map((a) => {
      const qualified = a.status === 'SUBMITTED' && a.totalCount ? a.score / a.totalCount >= QUALIFY_THRESHOLD : null;
      return {
        attemptId: a._id,
        testType: a.testType,
        status: a.status,
        score: a.score,
        totalCount: a.totalCount,
        warningCount: a.warningCount,
        startedAt: a.startedAt,
        submittedAt: a.submittedAt,
        qualified,
      };
    });

    const attemptsByType = {};
    for (const testType of TEST_TYPES) {
      const closedAttempts = attempts.filter(
        (a) => a.testType === testType && ['SUBMITTED', 'SUSPENDED'].includes(a.status)
      );
      const used = closedAttempts.length;
      const mostRecent = closedAttempts[0];
      let nextEligibleAt = null;

      if (mostRecent && mostRecent.submittedAt && used < MAX_ATTEMPTS_PER_TYPE) {
        const cooldownEnd = getCooldownEnd(mostRecent.submittedAt);
        if (cooldownEnd > new Date()) nextEligibleAt = cooldownEnd;
      }

      attemptsByType[testType] = {
        used,
        max: MAX_ATTEMPTS_PER_TYPE,
        remaining: Math.max(0, MAX_ATTEMPTS_PER_TYPE - used),
        nextEligibleAt,
      };
    }

    return res.status(200).json({ success: true, result: { results, attemptsByType } });
  } catch (err) {
    console.error('Get assessment results error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

async function getAttemptBreakdown(req, res) {
  try {
    const { attemptId } = req.params;
    const admin = req.admin;

    const AssessmentAttempt = mongoose.model('AssessmentAttempt');
    const AssessmentAttemptQuestion = mongoose.model('AssessmentAttemptQuestion');
    const AssessmentQuestion = mongoose.model('AssessmentQuestion');

    const attempt = await AssessmentAttempt.findById(attemptId).lean();
    if (!attempt || (String(attempt.candidate) !== String(admin._id) && attempt.candidateEmail !== admin.email)) {
      return res.status(404).json({ success: false, message: 'Attempt not found.' });
    }

    const attemptQuestions = await AssessmentAttemptQuestion.find({ attemptId }).lean();
    const questions = await AssessmentQuestion.find({
      _id: { $in: attemptQuestions.map((aq) => aq.questionId) },
    })
      .select('topic')
      .lean();
    const topicById = new Map(questions.map((q) => [String(q._id), q.topic]));

    const topicMap = {};
    for (const aq of attemptQuestions) {
      const topic = topicById.get(String(aq.questionId));
      if (!topicMap[topic]) topicMap[topic] = { topic, correct: 0, incorrect: 0, ungraded: 0 };
      if (aq.isCorrect === true) topicMap[topic].correct++;
      else if (aq.isCorrect === false) topicMap[topic].incorrect++;
      else topicMap[topic].ungraded++;
    }
    const breakdown = Object.values(topicMap).sort((a, b) => a.topic.localeCompare(b.topic));

    return res.status(200).json({
      success: true,
      result: { attemptId: attempt._id, testType: attempt.testType, status: attempt.status, breakdown },
    });
  } catch (err) {
    console.error('Get assessment breakdown error:', err);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
}

module.exports = { startTest, submitTest, runCode, getMyResults, getAttemptBreakdown };
