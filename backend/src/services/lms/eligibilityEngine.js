const mongoose = require('mongoose');

// Placement Readiness / Eligibility Engine (spec §4). Reads a course's
// EligibilityRule (admin-configurable criteria + weights + an overall
// threshold) and computes, per student, an achieved % for each enabled
// criterion against live data from the modules that already track it
// (attendance, curriculum progress, assignments, quizzes/surprise tests,
// policy acknowledgements) plus two forward-compatible criteria (project,
// proctoredAssessment) that soft-disable themselves ("not applicable")
// until their data sources exist, rather than blocking eligibility on
// something the org hasn't built/enabled yet.
//
// A criterion is a hard MANDATORY gate (must individually pass its own
// minPercent) and/or contributes to the WEIGHTED overall score — both at
// once is the common case, matching spec §4's "separate mandatory gates and
// weighted scores".

const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

const DEFAULT_CRITERIA = [
  { key: 'attendance', label: 'Attendance', enabled: true, mandatory: true, minPercent: 90, weight: 2 },
  { key: 'curriculum', label: 'Curriculum completion', enabled: true, mandatory: true, minPercent: 100, weight: 2 },
  { key: 'assignment', label: 'Assignments evaluated', enabled: true, mandatory: true, minPercent: 100, weight: 1 },
  { key: 'quiz', label: 'Quiz average score', enabled: true, mandatory: true, minPercent: 60, weight: 1 },
  { key: 'surpriseTest', label: 'Surprise tests', enabled: true, mandatory: false, minPercent: 60, weight: 1 },
  { key: 'acknowledgement', label: 'Policy acknowledgements', enabled: true, mandatory: true, minPercent: 100, weight: 1 },
  { key: 'project', label: 'Project approval', enabled: false, mandatory: false, minPercent: 100, weight: 1 },
  { key: 'proctoredAssessment', label: 'Proctored assessment', enabled: false, mandatory: false, minPercent: 60, weight: 1 },
];
const LABELS = Object.fromEntries(DEFAULT_CRITERIA.map((c) => [c.key, c.label]));

async function metricFor(key, { crmUserId, courseId, roster }) {
  switch (key) {
    case 'attendance':
      return { achievedPercent: roster ? roster.attendancePct || 0 : 0, applicable: true };

    case 'curriculum': {
      const CourseProgress = mongoose.model('CourseProgress');
      const cp = await CourseProgress.findOne({ crmUser: crmUserId, course: courseId }).lean();
      return { achievedPercent: cp ? cp.percent || 0 : 0, applicable: true };
    }

    case 'assignment': {
      const Assignment = mongoose.model('Assignment');
      const AssignmentSubmission = mongoose.model('AssignmentSubmission');
      const total = await Assignment.countDocuments({ course: courseId, removed: false, published: true });
      if (!total) return { achievedPercent: 100, applicable: false, detail: 'No assignments published yet' };
      const done = await AssignmentSubmission.countDocuments({ course: courseId, student: crmUserId, status: 'evaluated', removed: { $ne: true } });
      return { achievedPercent: Math.round((done / total) * 100), applicable: true, detail: `${done}/${total} evaluated` };
    }

    case 'quiz':
    case 'surpriseTest': {
      const Quiz = mongoose.model('Quiz');
      const QuizAttempt = mongoose.model('QuizAttempt');
      const typeFilter = key === 'surpriseTest' ? 'surprise_test' : { $in: ['quiz', 'exam'] };
      const quizzes = await Quiz.find({ course: courseId, published: true, type: typeFilter }).select('_id').lean();
      if (!quizzes.length) return { achievedPercent: 100, applicable: false, detail: key === 'surpriseTest' ? 'No surprise tests set' : 'No quizzes set' };
      const atts = await QuizAttempt.find({
        course: courseId,
        student: crmUserId,
        status: 'evaluated',
        quiz: { $in: quizzes.map((q) => q._id) },
      }).select('percent').lean();
      if (!atts.length) return { achievedPercent: 0, applicable: true, detail: 'Not attempted yet' };
      const avg = Math.round(atts.reduce((a, b) => a + (b.percent || 0), 0) / atts.length);
      return { achievedPercent: avg, applicable: true, detail: `${atts.length} attempt(s)` };
    }

    case 'acknowledgement': {
      const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
      const rows = await PolicyAcknowledgement.find({ student: crmUserId, removed: { $ne: true } }).select('status').lean();
      if (!rows.length) return { achievedPercent: 100, applicable: false, detail: 'No policies assigned' };
      const done = rows.filter((r) => r.status === 'acknowledged').length;
      return { achievedPercent: Math.round((done / rows.length) * 100), applicable: true, detail: `${done}/${rows.length} acknowledged` };
    }

    // Forward-compatible: soft-disables until the Project Management module
    // (spec §10, not built yet) registers a `Project` model.
    case 'project': {
      try {
        const Project = mongoose.model('Project');
        const p = await Project.findOne({ course: courseId, student: crmUserId, removed: { $ne: true } }).select('status').lean();
        if (!p) return { achievedPercent: 0, applicable: true, detail: 'No project assigned' };
        return { achievedPercent: p.status === 'Approved' ? 100 : 0, applicable: true, detail: p.status };
      } catch (e) {
        return { achievedPercent: 100, applicable: false, detail: 'Project module not enabled yet' };
      }
    }

    // Uses the existing proctored-assessment subsystem (AssessmentAttempt),
    // which is course-agnostic (testType, not course-scoped) — counted across
    // the candidate's own submitted attempts.
    case 'proctoredAssessment': {
      const AssessmentAttempt = mongoose.model('AssessmentAttempt');
      const attempts = await AssessmentAttempt.find({ candidate: crmUserId, status: 'SUBMITTED', totalCount: { $gt: 0 } })
        .select('score totalCount')
        .lean();
      if (!attempts.length) return { achievedPercent: 0, applicable: false, detail: 'Not attempted' };
      const avg = Math.round(attempts.reduce((a, b) => a + (b.score / b.totalCount) * 100, 0) / attempts.length);
      return { achievedPercent: avg, applicable: true, detail: `${attempts.length} attempt(s)` };
    }

    default:
      return { achievedPercent: 0, applicable: false };
  }
}

async function evaluate(crmUserId, courseId) {
  if (!mongoose.isValidObjectId(crmUserId) || !mongoose.isValidObjectId(courseId)) return null;
  const Course = mongoose.model('Course');
  const Admin = mongoose.model('Admin');
  const EligibilityRule = mongoose.model('EligibilityRule');
  const Student = mongoose.model('Student');

  const [course, user, rule] = await Promise.all([
    Course.findById(courseId).lean(),
    Admin.findById(crmUserId).select('name email').lean(),
    EligibilityRule.findOne({ course: courseId, removed: { $ne: true } }).lean(),
  ]);
  if (!course || !user) return null;

  const R = rule && rule.enabled !== false ? rule : { criteria: DEFAULT_CRITERIA, overallThresholdPercent: 90 };
  const roster = user.email
    ? await Student.findOne({ email: rxEq(user.email), course: rxEq(course.title || ''), removed: false }).select('attendancePct batch').lean()
    : null;

  const items = [];
  let weightedSum = 0;
  let weightTotal = 0;
  const mandatoryFailed = [];
  const notStarted = [];

  for (const c of (R.criteria || []).filter((c) => c.enabled !== false)) {
    // eslint-disable-next-line no-await-in-loop
    const m = await metricFor(c.key, { crmUserId, courseId, roster });
    const passed = !m.applicable || m.achievedPercent >= (c.minPercent || 0);
    if (m.applicable) {
      weightedSum += m.achievedPercent * (c.weight || 1);
      weightTotal += c.weight || 1;
    }
    if (c.mandatory && m.applicable && !passed) mandatoryFailed.push(c.key);
    if (m.applicable && m.achievedPercent === 0) notStarted.push(c.key);
    items.push({
      key: c.key,
      label: c.label || LABELS[c.key] || c.key,
      mandatory: !!c.mandatory,
      required: c.minPercent || 0,
      achieved: m.achievedPercent,
      applicable: m.applicable,
      passed,
      detail: m.detail,
    });
  }

  const score = weightTotal ? Math.round(weightedSum / weightTotal) : 0;
  const threshold = R.overallThresholdPercent || 90;
  const eligible = score >= threshold && mandatoryFailed.length === 0;
  let state = 'Not Yet Eligible';
  if (eligible) state = 'Eligible';
  else if (mandatoryFailed.length && notStarted.length) state = 'Action Required';

  return {
    course: { id: String(course._id), title: course.title },
    score,
    threshold,
    eligible,
    state,
    missing: items.filter((i) => i.applicable && !i.passed).map((i) => i.label),
    items,
  };
}

// All courses a student (by their Student roster rows) is enrolled in.
async function myEligibility(admin) {
  const Student = mongoose.model('Student');
  const Course = mongoose.model('Course');
  const roster = await Student.find({ removed: false, email: rxEq(admin.email || '') }).select('course').lean();
  const titles = [...new Set(roster.map((r) => r.course).filter(Boolean))];
  if (!titles.length) return [];
  const courses = await Course.find({ removed: false, title: { $in: titles.map(rxEq) } }).select('_id').lean();
  const out = [];
  for (const c of courses) {
    // eslint-disable-next-line no-await-in-loop
    const r = await evaluate(admin._id, c._id).catch(() => null);
    if (r) out.push(r);
  }
  return out;
}

module.exports = { evaluate, myEligibility, DEFAULT_CRITERIA };
