const mongoose = require('mongoose');
const { assignQuestions } = require('../../../../../services/lms/assessments/roundRobinService');
const { runPythonCode, normalizeOutput } = require('../../../../../services/lms/assessments/codeExecutionService');
const assessmentSettings = require('../../../../../services/lms/assessmentSettingsService');

// Ported from python-test-platform's src/controllers/testController.js
// (Prisma -> Mongoose). Auth is the CRM's own bearer auth (req.admin), not the
// reference project's separate User/JWT — there is no role check here either,
// matching the reference (any authenticated user may start/submit/run-code).

// qualifyThreshold/maxAttemptsPerType/cooldownDays now come from
// assessmentSettingsService (LmsSetting('assessments')), admin-configurable —
// see routes/appRoutes/lms/lmsApi.js's /admin/assessment-settings. These were
// previously hardcoded constants independently duplicated in
// adminController.js too (spec §10 "not admin-configurable").
const TEST_TYPES = ['BASIC', 'MAJOR', 'MICRO', 'NLP_MICRO', 'NLP_MAJOR'];

// Cooldown lifts at midnight UTC on the Nth calendar day after submission,
// not at the exact submission time — so a 3pm submission doesn't require
// waiting until 3pm exactly N days later.
function getCooldownEnd(submittedAt, cooldownDays) {
  return new Date(
    Date.UTC(submittedAt.getUTCFullYear(), submittedAt.getUTCMonth(), submittedAt.getUTCDate() + cooldownDays)
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

    const { maxAttemptsPerType, cooldownDays } = await assessmentSettings.get();
    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;

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
    if (totalAttempts >= maxAttemptsPerType) {
      return res.status(403).json({
        success: false,
        message: `You have used all ${maxAttemptsPerType} attempts for this test.`,
        attemptsUsed: totalAttempts,
        maxAttempts: maxAttemptsPerType,
      });
    }

    const cooldownWindowStart = new Date(Date.now() - cooldownMs);
    const recentClosedAttempt = await AssessmentAttempt.findOne({
      candidate: admin._id,
      testType,
      status: { $in: ['SUBMITTED', 'SUSPENDED'] },
      submittedAt: { $gte: cooldownWindowStart },
    }).sort({ submittedAt: -1 });

    if (recentClosedAttempt && recentClosedAttempt.submittedAt) {
      const nextEligible = getCooldownEnd(recentClosedAttempt.submittedAt, cooldownDays);
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

    let attempt;
    try {
      attempt = await AssessmentAttempt.create({
        testType,
        totalCount: questions.length,
        candidate: admin._id,
        candidateName: `${admin.name || ''} ${admin.surname || ''}`.trim(),
        candidateEmail: admin.email,
        candidateBatch: (student && student.batch) || null,
      });
    } catch (e) {
      // Lost the race against another concurrent startTest for the same
      // candidate+testType (see the partial unique index on the model) —
      // same response the upfront "no existing IN_PROGRESS attempt" check
      // above already returns for the non-racing case.
      if (e.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'You already have an in-progress attempt for this test.',
        });
      }
      throw e;
    }

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

    const { qualifyThreshold } = await assessmentSettings.get();

    attempt.status = 'SUBMITTED';
    attempt.score = correctCount;
    attempt.submittedAt = new Date();
    attempt.qualified = attempt.totalCount ? correctCount / attempt.totalCount >= qualifyThreshold : false;
    await attempt.save();

    // Spec §9 "Assessment result email/message can be generated automatically
    // from the final result" — previously this whole controller never sent
    // one; a learner only ever found out their result by separately polling
    // getMyResults. Best-effort, same shape as projects.js#review's email.
    try {
      const pct = attempt.totalCount ? Math.round((correctCount / attempt.totalCount) * 100) : 0;
      await require('../../../../../services/lms/realtime').notify([admin._id], {
        type: 'assessment.result',
        title: `${attempt.testType} result: ${attempt.qualified ? 'Qualified' : 'Not qualified'}`,
        body: `Score: ${correctCount}/${attempt.totalCount} (${pct}%)`,
        link: '/learn/results',
      });
      if (attempt.candidateEmail) {
        const mailer = require('../../../../../services/lms/mailer');
        await mailer.sendMail([attempt.candidateEmail], {
          subject: `${attempt.testType} result: ${attempt.qualified ? 'Qualified' : 'Not qualified'}`,
          html: `<p>Hi ${attempt.candidateName || ''},</p><p>Your <b>${attempt.testType}</b> assessment has been evaluated.</p><p>Score: <b>${correctCount}/${attempt.totalCount}</b> (${pct}%)<br>Status: <b>${attempt.qualified ? 'Qualified' : 'Not qualified'}</b></p><p>Sign in to the portal to see the full topic-wise breakdown.</p>`,
        });
      }
    } catch (e) {
      console.error('[lms] assessment result notification failed:', e && e.message);
    }

    return res.status(200).json({
      success: true,
      result: {
        attemptId: attempt._id,
        status: attempt.status,
        score: correctCount,
        gradableTotal: gradableCount,
        totalCount: attempt.totalCount,
        qualified: attempt.qualified,
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
    const { qualifyThreshold, maxAttemptsPerType, cooldownDays } = await assessmentSettings.get();

    const attempts = await AssessmentAttempt.find({
      $or: [{ candidate: admin._id }, { candidateEmail: admin.email }],
    })
      .sort({ startedAt: -1 })
      .lean();

    const results = attempts.map((a) => {
      // Prefer the persisted field (set at submission time); fall back to
      // recomputing only for attempts submitted before this field existed.
      const qualified =
        a.qualified !== undefined && a.qualified !== null
          ? a.qualified
          : a.status === 'SUBMITTED' && a.totalCount
          ? a.score / a.totalCount >= qualifyThreshold
          : null;
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

      if (mostRecent && mostRecent.submittedAt && used < maxAttemptsPerType) {
        const cooldownEnd = getCooldownEnd(mostRecent.submittedAt, cooldownDays);
        if (cooldownEnd > new Date()) nextEligibleAt = cooldownEnd;
      }

      attemptsByType[testType] = {
        used,
        max: maxAttemptsPerType,
        remaining: Math.max(0, maxAttemptsPerType - used),
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
