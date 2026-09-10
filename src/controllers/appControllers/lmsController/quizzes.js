const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES, LMS_STUDENT_ROLES } = require('../../../config/roles');

// Quizzes / Exams + Question Bank.
//
//  teacher/manager:
//   POST   /api/lms/quizzes                     { course, title, type, ... }
//   GET    /api/lms/quizzes?course=
//   GET    /api/lms/quizzes/:id                 (full, incl. answers)
//   PATCH  /api/lms/quizzes/:id
//   DELETE /api/lms/quizzes/:id
//   POST   /api/lms/quizzes/:id/questions       { type, text, options, ... }
//   PATCH  /api/lms/questions/:id
//   DELETE /api/lms/questions/:id
//   GET    /api/lms/question-bank?course=
//   GET    /api/lms/quizzes/:id/results
//   POST   /api/lms/attempts/:id/evaluate       { scores: [{ question, awarded }] }
//  student:
//   GET    /api/lms/my/quizzes
//   POST   /api/lms/quizzes/:id/start           -> attempt + questions (no answers)
//   POST   /api/lms/attempts/:id/submit         { answers: [{ question, chosen, text }] }
//   GET    /api/lms/attempts/:id/result

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function ownedCourseIds(admin) {
  const Course = mongoose.model('Course');
  const rows = await Course.find({ removed: false, instructor: rxEq(admin.name || '') }).select('_id').lean();
  return rows.map((c) => String(c._id));
}
async function enrolledCourseIds(admin) {
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  const rows = await Student.find({ removed: false, email: rxEq(admin.email || '') }).select('course').lean();
  const titles = [...new Set(rows.map((r) => r.course).filter(Boolean))];
  if (!titles.length) return [];
  const courses = await Course.find({ removed: false, title: { $in: titles.map((t) => rxEq(t)) } }).select('_id').lean();
  return courses.map((c) => String(c._id));
}
async function assertOwnsQuiz(admin, quiz) {
  if (isManager(admin)) return true;
  if (quiz.teacherCrmUser && String(quiz.teacherCrmUser) === String(admin._id)) return true;
  return (await ownedCourseIds(admin)).includes(String(quiz.course));
}

/* ───────────── teacher: quiz CRUD ───────────── */
const QUIZ_FIELDS = [
  'title', 'description', 'type', 'timeLimitMin', 'totalQuestions', 'randomizeQuestions', 'randomizeOptions',
  'passingPercent', 'negativeMarking', 'negativeMarkPerWrong', 'attemptsAllowed', 'instantResult', 'showAnswers',
  'startAt', 'endAt', 'published', 'batch', 'module', 'lesson',
];

async function createQuiz(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Teachers only.');
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.course)) return bad(res, 400, 'A valid course is required.');
  const course = await mongoose.model('Course').findOne({ _id: b.course, removed: false });
  if (!course) return bad(res, 404, 'Course not found.');
  if (!isManager(req.admin) && !(course.instructor && rxEq(course.instructor).test(req.admin.name || '')))
    return bad(res, 403, 'You can only add quizzes to your own courses.');

  const Quiz = mongoose.model('Quiz');
  const doc = { course: course._id, teacherCrmUser: req.admin._id, teacherName: req.admin.name, title: (b.title || 'Untitled quiz').trim() };
  for (const f of QUIZ_FIELDS) if (b[f] !== undefined) doc[f] = b[f];
  const q = await Quiz.create(doc);
  return ok(res, { id: String(q._id) }, 'Quiz created.');
}

async function listQuizzes(req, res) {
  const Quiz = mongoose.model('Quiz');
  const q = { removed: false };
  if (mongoose.isValidObjectId(req.query.course)) q.course = req.query.course;
  if (!isManager(req.admin)) {
    const ids = await ownedCourseIds(req.admin);
    q.$or = [{ teacherCrmUser: req.admin._id }, { course: { $in: ids } }];
  }
  const rows = await Quiz.find(q).sort({ created: -1 }).lean();
  const Question = mongoose.model('Question');
  const Attempt = mongoose.model('QuizAttempt');
  const [qCounts, aCounts] = await Promise.all([
    Question.aggregate([{ $match: { quiz: { $in: rows.map((r) => r._id) }, removed: { $ne: true } } }, { $group: { _id: '$quiz', n: { $sum: 1 } } }]),
    Attempt.aggregate([{ $match: { quiz: { $in: rows.map((r) => r._id) }, status: { $ne: 'in_progress' } } }, { $group: { _id: '$quiz', n: { $sum: 1 }, avg: { $avg: '$percent' } } }]),
  ]);
  const qn = {}; qCounts.forEach((c) => { qn[String(c._id)] = c.n; });
  const an = {}; aCounts.forEach((c) => { an[String(c._id)] = { attempts: c.n, avgPercent: Math.round(c.avg || 0) }; });
  return ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      title: r.title,
      type: r.type,
      course: String(r.course),
      published: r.published,
      passingPercent: r.passingPercent,
      timeLimitMin: r.timeLimitMin,
      questions: qn[String(r._id)] || 0,
      ...(an[String(r._id)] || { attempts: 0, avgPercent: 0 }),
    }))
  );
}

async function getQuiz(req, res) {
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findOne({ _id: req.params.id, removed: false }).lean();
  if (!quiz) return bad(res, 404, 'Quiz not found.');
  if (!(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  const Question = mongoose.model('Question');
  const questions = await Question.find({ quiz: quiz._id, removed: { $ne: true } }).sort({ order: 1 }).lean();
  return ok(res, { ...quiz, id: String(quiz._id), questions: questions.map((q) => ({ ...q, id: String(q._id) })) });
}

async function updateQuiz(req, res) {
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findOne({ _id: req.params.id, removed: false });
  if (!quiz) return bad(res, 404, 'Quiz not found.');
  if (!(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  for (const f of QUIZ_FIELDS) if (req.body[f] !== undefined) quiz[f] = req.body[f];
  quiz.updated = new Date();
  await quiz.save();
  return ok(res, { id: String(quiz._id) }, 'Quiz updated.');
}

async function deleteQuiz(req, res) {
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findOne({ _id: req.params.id, removed: false });
  if (!quiz) return bad(res, 404, 'Quiz not found.');
  if (!(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  quiz.removed = true;
  quiz.updated = new Date();
  await quiz.save();
  await mongoose.model('Question').updateMany({ quiz: quiz._id }, { $set: { removed: true } });
  return ok(res, {}, 'Quiz removed.');
}

/* ───────────── teacher: questions ───────────── */
function normalizeQuestion(b) {
  const type = ['mcq', 'multiple', 'truefalse', 'fill', 'short', 'long'].includes(b.type) ? b.type : 'mcq';
  const out = { type, text: (b.text || '').trim(), marks: Number(b.marks) || 1, explanation: b.explanation || '', order: Number(b.order) || 0 };
  if (['mcq', 'multiple', 'truefalse'].includes(type)) {
    let opts = Array.isArray(b.options) ? b.options : [];
    if (type === 'truefalse' && opts.length === 0) opts = [{ key: 'true', text: 'True' }, { key: 'false', text: 'False' }];
    out.options = opts.map((o, i) => ({ key: o.key || String.fromCharCode(97 + i), text: String(o.text || '').trim(), correct: !!o.correct }));
    out.correctText = [];
  } else {
    out.options = [];
    out.correctText = (Array.isArray(b.correctText) ? b.correctText : String(b.correctText || '').split('|'))
      .map((s) => String(s).trim())
      .filter(Boolean);
  }
  return out;
}

async function addQuestion(req, res) {
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findOne({ _id: req.params.id, removed: false });
  if (!quiz) return bad(res, 404, 'Quiz not found.');
  if (!(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  const Question = mongoose.model('Question');
  const n = normalizeQuestion(req.body || {});
  if (!n.text) return bad(res, 400, 'Question text is required.');
  const last = await Question.findOne({ quiz: quiz._id, removed: { $ne: true } }).sort({ order: -1 }).select('order').lean();
  n.order = (last?.order || 0) + 10;
  const doc = await Question.create({ ...n, quiz: quiz._id, course: quiz.course });
  if (['short', 'long'].includes(n.type)) await Quiz.updateOne({ _id: quiz._id }, { $set: { manualEvaluation: true } });
  return ok(res, { id: String(doc._id) }, 'Question added.');
}

async function updateQuestion(req, res) {
  const Question = mongoose.model('Question');
  const qn = await Question.findOne({ _id: req.params.id, removed: { $ne: true } });
  if (!qn) return bad(res, 404, 'Question not found.');
  const quiz = await mongoose.model('Quiz').findById(qn.quiz);
  if (!quiz || !(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  const n = normalizeQuestion({ ...qn.toObject(), ...req.body });
  Object.assign(qn, n, { updated: new Date() });
  await qn.save();
  return ok(res, { id: String(qn._id) }, 'Question updated.');
}

async function deleteQuestion(req, res) {
  const Question = mongoose.model('Question');
  const qn = await Question.findOne({ _id: req.params.id, removed: { $ne: true } });
  if (!qn) return bad(res, 404, 'Question not found.');
  const quiz = await mongoose.model('Quiz').findById(qn.quiz);
  if (!quiz || !(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  qn.removed = true;
  qn.updated = new Date();
  await qn.save();
  return ok(res, {}, 'Question removed.');
}

async function questionBank(req, res) {
  const Question = mongoose.model('Question');
  const q = { removed: { $ne: true } };
  if (mongoose.isValidObjectId(req.query.course)) q.course = req.query.course;
  else if (!isManager(req.admin)) q.course = { $in: await ownedCourseIds(req.admin) };
  if (req.query.type) q.type = req.query.type;
  const rows = await Question.find(q).sort({ created: -1 }).limit(500).lean();
  return ok(res, rows.map((r) => ({ ...r, id: String(r._id) })));
}

/* ───────────── grading ───────────── */
function gradeAnswer(question, ans) {
  const marks = question.marks || 1;
  const t = question.type;
  if (t === 'long') return { awarded: 0, correct: null, auto: false }; // always manual
  if (['mcq', 'truefalse'].includes(t)) {
    const correctKey = (question.options.find((o) => o.correct) || {}).key;
    const chosen = (ans.chosen || [])[0];
    const isCorrect = !!correctKey && chosen === correctKey;
    return { awarded: isCorrect ? marks : 0, correct: isCorrect, auto: true };
  }
  if (t === 'multiple') {
    const correctSet = new Set(question.options.filter((o) => o.correct).map((o) => o.key));
    const chosenSet = new Set(ans.chosen || []);
    const exact = correctSet.size === chosenSet.size && [...correctSet].every((k) => chosenSet.has(k));
    return { awarded: exact ? marks : 0, correct: exact, auto: true };
  }
  if (['fill', 'short'].includes(t)) {
    const given = String(ans.text || '').trim().toLowerCase();
    const isCorrect = (question.correctText || []).some((c) => String(c).trim().toLowerCase() === given) && given !== '';
    // short answers can be re-scored by the teacher; fill is final
    return { awarded: isCorrect ? marks : 0, correct: isCorrect, auto: t === 'fill' };
  }
  return { awarded: 0, correct: null, auto: true };
}

/* ───────────── student ───────────── */
async function myQuizzes(req, res) {
  const Quiz = mongoose.model('Quiz');
  const Attempt = mongoose.model('QuizAttempt');
  const courseIds = isManager(req.admin) || isTeacher(req.admin) ? null : await enrolledCourseIds(req.admin);
  const q = { removed: false, published: true };
  if (courseIds) {
    if (!courseIds.length) return ok(res, []);
    q.course = { $in: courseIds };
  }
  const [rows, attempts, courses] = await Promise.all([
    Quiz.find(q).sort({ created: -1 }).lean(),
    Attempt.find({ student: req.admin._id }).lean(),
    mongoose.model('Course').find({ removed: false }).select('title').lean(),
  ]);
  const cName = {}; courses.forEach((c) => { cName[String(c._id)] = c.title; });
  const byQuiz = {};
  attempts.forEach((a) => {
    const k = String(a.quiz);
    byQuiz[k] = byQuiz[k] || [];
    byQuiz[k].push(a);
  });
  const Question = mongoose.model('Question');
  const qCounts = await Question.aggregate([{ $match: { quiz: { $in: rows.map((r) => r._id) }, removed: { $ne: true } } }, { $group: { _id: '$quiz', n: { $sum: 1 } } }]);
  const qn = {}; qCounts.forEach((c) => { qn[String(c._id)] = c.n; });
  return ok(
    res,
    rows.map((r) => {
      const mine = (byQuiz[String(r._id)] || []).sort((a, b) => (b.attempt || 0) - (a.attempt || 0));
      const latest = mine[0];
      return {
        id: String(r._id),
        title: r.title,
        type: r.type,
        course: cName[String(r.course)] || '',
        questions: qn[String(r._id)] || 0,
        timeLimitMin: r.timeLimitMin,
        passingPercent: r.passingPercent,
        attemptsAllowed: r.attemptsAllowed,
        attemptsUsed: mine.filter((a) => a.status !== 'in_progress').length,
        inProgressAttemptId: mine.find((a) => a.status === 'in_progress') ? String(mine.find((a) => a.status === 'in_progress')._id) : null,
        lastResult: latest && latest.status !== 'in_progress'
          ? { attemptId: String(latest._id), percent: latest.percent, passed: latest.passed, status: latest.status }
          : null,
      };
    })
  );
}

async function startAttempt(req, res) {
  if (!isStudent(req.admin) && !isManager(req.admin)) return bad(res, 403, 'Students only.');
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findOne({ _id: req.params.id, removed: false, published: true });
  if (!quiz) return bad(res, 404, 'Quiz not found.');
  if (!isManager(req.admin)) {
    const ids = await enrolledCourseIds(req.admin);
    if (!ids.includes(String(quiz.course))) return bad(res, 403, 'You are not enrolled in this course.');
  }
  const now = new Date();
  if (quiz.startAt && now < new Date(quiz.startAt)) return bad(res, 409, 'This quiz has not opened yet.');
  if (quiz.endAt && now > new Date(quiz.endAt)) return bad(res, 409, 'This quiz has closed.');

  const Attempt = mongoose.model('QuizAttempt');
  const existing = await Attempt.find({ quiz: quiz._id, student: req.admin._id }).sort({ attempt: -1 });
  const inProgress = existing.find((a) => a.status === 'in_progress');
  let attempt = inProgress;
  const usedCount = existing.filter((a) => a.status !== 'in_progress').length;

  if (!attempt) {
    if (quiz.attemptsAllowed && usedCount >= quiz.attemptsAllowed) return bad(res, 409, 'No attempts left.');
    attempt = await Attempt.create({
      quiz: quiz._id,
      course: quiz.course,
      student: req.admin._id,
      studentName: req.admin.name,
      studentEmail: req.admin.email,
      attempt: (existing[0]?.attempt || 0) + 1,
      startedAt: now,
      dueAt: quiz.timeLimitMin ? new Date(now.getTime() + quiz.timeLimitMin * 60000) : undefined,
      status: 'in_progress',
    });
  }

  const Question = mongoose.model('Question');
  let questions = await Question.find({ quiz: quiz._id, removed: { $ne: true } }).sort({ order: 1 }).lean();
  if (quiz.randomizeQuestions) questions = shuffle(questions);
  if (quiz.totalQuestions && quiz.totalQuestions < questions.length) questions = questions.slice(0, quiz.totalQuestions);

  // strip correct answers before sending to the student
  const safe = questions.map((q) => ({
    id: String(q._id),
    type: q.type,
    text: q.text,
    marks: q.marks,
    options: ['mcq', 'multiple', 'truefalse'].includes(q.type)
      ? (quiz.randomizeOptions ? shuffle(q.options) : q.options).map((o) => ({ key: o.key, text: o.text }))
      : undefined,
  }));

  return ok(res, {
    attemptId: String(attempt._id),
    quiz: { id: String(quiz._id), title: quiz.title, type: quiz.type, timeLimitMin: quiz.timeLimitMin, instantResult: quiz.instantResult },
    dueAt: attempt.dueAt,
    questions: safe,
  });
}

async function submitAttempt(req, res) {
  const Attempt = mongoose.model('QuizAttempt');
  const attempt = await Attempt.findOne({ _id: req.params.id, removed: { $ne: true } });
  if (!attempt) return bad(res, 404, 'Attempt not found.');
  if (String(attempt.student) !== String(req.admin._id) && !isManager(req.admin)) return bad(res, 403, 'Not your attempt.');
  if (attempt.status !== 'in_progress') return bad(res, 409, 'This attempt is already submitted.');

  const Quiz = mongoose.model('Quiz');
  const Question = mongoose.model('Question');
  const quiz = await Quiz.findById(attempt.quiz).lean();
  const questions = await Question.find({ quiz: attempt.quiz, removed: { $ne: true } }).lean();
  const qById = {}; questions.forEach((q) => { qById[String(q._id)] = q; });

  const given = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const answers = [];
  let auto = 0;
  let max = 0;
  let anyManual = false;

  for (const q of questions) {
    max += q.marks || 1;
    const a = given.find((x) => String(x.question) === String(q._id)) || {};
    const g = gradeAnswer(q, a);
    if (!g.auto) anyManual = true;
    auto += g.awarded;
    if (g.correct === false && quiz.negativeMarking && quiz.negativeMarkPerWrong && (a.chosen?.length || a.text)) {
      auto -= quiz.negativeMarkPerWrong;
    }
    answers.push({ question: q._id, chosen: a.chosen || [], text: a.text || '', awarded: g.awarded, correct: g.correct, auto: g.auto });
  }
  auto = Math.max(0, auto);

  attempt.answers = answers;
  attempt.autoScore = auto;
  attempt.maxScore = max;
  attempt.manualScore = 0;
  attempt.totalScore = auto;
  attempt.percent = max ? Math.round((auto / max) * 100) : 0;
  attempt.passed = attempt.percent >= (quiz.passingPercent || 0);
  attempt.submittedAt = new Date();
  attempt.status = anyManual || quiz.manualEvaluation ? 'submitted' : 'evaluated';
  attempt.updated = new Date();
  await attempt.save();

  await mirrorQuizScoreToRoster(attempt, quiz);

  const showResult = quiz.instantResult && attempt.status === 'evaluated';
  return ok(res, {
    attemptId: String(attempt._id),
    status: attempt.status,
    result: showResult
      ? { percent: attempt.percent, passed: attempt.passed, totalScore: attempt.totalScore, maxScore: attempt.maxScore }
      : null,
    pendingManual: attempt.status === 'submitted',
  }, attempt.status === 'submitted' ? 'Submitted — awaiting teacher evaluation.' : 'Submitted.');
}

async function attemptResult(req, res) {
  const Attempt = mongoose.model('QuizAttempt');
  const attempt = await Attempt.findOne({ _id: req.params.id, removed: { $ne: true } }).lean();
  if (!attempt) return bad(res, 404, 'Attempt not found.');
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findById(attempt.quiz).lean();
  const owns = quiz && (await assertOwnsQuiz(req.admin, quiz));
  if (String(attempt.student) !== String(req.admin._id) && !owns) return bad(res, 403, 'Not your result.');

  const Question = mongoose.model('Question');
  const questions = await Question.find({ _id: { $in: attempt.answers.map((a) => a.question) } }).lean();
  const qById = {}; questions.forEach((q) => { qById[String(q._id)] = q; });
  const reveal = owns || (quiz.showAnswers && attempt.status === 'evaluated');

  return ok(res, {
    attemptId: String(attempt._id),
    quiz: { id: String(quiz._id), title: quiz.title, passingPercent: quiz.passingPercent },
    status: attempt.status,
    percent: attempt.percent,
    passed: attempt.passed,
    totalScore: attempt.totalScore,
    maxScore: attempt.maxScore,
    submittedAt: attempt.submittedAt,
    answers: attempt.answers.map((a) => {
      const q = qById[String(a.question)] || {};
      return {
        question: q.text,
        type: q.type,
        marks: q.marks,
        // question id is only exposed to the quiz owner (for manual grading)
        questionId: owns ? String(a.question) : undefined,
        yourAnswer: a.chosen && a.chosen.length ? a.chosen : a.text,
        awarded: a.awarded,
        correct: a.correct,
        needsManual: a.auto === false,
        ...(reveal
          ? {
              correctAnswer: ['mcq', 'multiple', 'truefalse'].includes(q.type)
                ? (q.options || []).filter((o) => o.correct).map((o) => o.text)
                : q.correctText,
              explanation: q.explanation,
            }
          : {}),
      };
    }),
  });
}

async function quizResults(req, res) {
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findOne({ _id: req.params.id, removed: false }).lean();
  if (!quiz) return bad(res, 404, 'Quiz not found.');
  if (!(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');
  const Attempt = mongoose.model('QuizAttempt');
  const rows = await Attempt.find({ quiz: quiz._id, status: { $ne: 'in_progress' } }).sort({ submittedAt: -1 }).lean();
  return ok(res, {
    quiz: { id: String(quiz._id), title: quiz.title, passingPercent: quiz.passingPercent, maxScore: rows[0]?.maxScore || 0 },
    attempts: rows.map((a) => ({
      id: String(a._id),
      studentName: a.studentName,
      studentEmail: a.studentEmail,
      attempt: a.attempt,
      submittedAt: a.submittedAt,
      percent: a.percent,
      totalScore: a.totalScore,
      maxScore: a.maxScore,
      passed: a.passed,
      status: a.status,
      needsManual: a.answers.some((x) => x.auto === false),
    })),
  });
}

async function evaluateAttempt(req, res) {
  const Attempt = mongoose.model('QuizAttempt');
  const attempt = await Attempt.findOne({ _id: req.params.id, removed: { $ne: true } });
  if (!attempt) return bad(res, 404, 'Attempt not found.');
  const Quiz = mongoose.model('Quiz');
  const quiz = await Quiz.findById(attempt.quiz).lean();
  if (!quiz || !(await assertOwnsQuiz(req.admin, quiz))) return bad(res, 403, 'Not your quiz.');

  const scores = Array.isArray(req.body?.scores) ? req.body.scores : [];
  const byQ = {};
  scores.forEach((s) => { if (s && s.question != null) byQ[String(s.question)] = Number(s.awarded) || 0; });

  let manual = 0;
  attempt.answers = attempt.answers.map((a) => {
    if (a.auto === false && byQ[String(a.question)] != null) {
      a.awarded = Math.max(0, byQ[String(a.question)]);
      a.correct = a.awarded > 0;
    }
    if (a.auto === false) manual += a.awarded || 0;
    return a;
  });
  attempt.manualScore = manual;
  attempt.totalScore = Math.max(0, (attempt.autoScore || 0) + manual);
  attempt.percent = attempt.maxScore ? Math.round((attempt.totalScore / attempt.maxScore) * 100) : 0;
  attempt.passed = attempt.percent >= (quiz.passingPercent || 0);
  attempt.status = 'evaluated';
  attempt.evaluatedBy = req.admin._id;
  attempt.evaluatedAt = new Date();
  attempt.updated = new Date();
  await attempt.save();
  await mirrorQuizScoreToRoster(attempt, quiz);
  return ok(res, { id: String(attempt._id), percent: attempt.percent, passed: attempt.passed }, 'Evaluated.');
}

async function mirrorQuizScoreToRoster(attempt, quiz) {
  try {
    if (attempt.status !== 'evaluated') return;
    const Attempt = mongoose.model('QuizAttempt');
    const all = await Attempt.find({ student: attempt.student, status: 'evaluated' }).select('percent').lean();
    if (!all.length) return;
    const avg = Math.round(all.reduce((a, b) => a + (b.percent || 0), 0) / all.length);
    const course = await mongoose.model('Course').findById(quiz.course).select('title').lean();
    if (!course?.title) return;
    await mongoose.model('Student').updateMany(
      { email: rxEq(attempt.studentEmail || ''), course: course.title, removed: false },
      { $set: { avgScore: avg, updated: new Date() } }
    );
  } catch (e) {
    /* non-fatal */
  }
  try {
    require('../../../services/lms/certificateEngine').evaluateSafe(attempt.student, quiz.course);
  } catch (e) {
    /* non-fatal */
  }
}

module.exports = {
  createQuiz, listQuizzes, getQuiz, updateQuiz, deleteQuiz,
  addQuestion, updateQuestion, deleteQuestion, questionBank,
  myQuizzes, startAttempt, submitAttempt, attemptResult, quizResults, evaluateAttempt,
};
