const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');
const engine = require('../../../../services/lms/eligibilityEngine');
const auditLog = require('../../../../services/lms/auditLog');

// Eligibility / Placement Readiness Engine (spec §4).
//  manager/teacher:
//   GET   /api/lms/courses/:courseId/eligibility-rule
//   POST  /api/lms/courses/:courseId/eligibility-rule   (manager only, upsert)
//   GET   /api/lms/eligibility/course/:courseId/report   (all enrolled students)
//  student:
//   GET   /api/lms/my/eligibility                        (every enrolled course)

const isManager = (a) => !!(a && MANAGEMENT_ROLES.includes(a.role));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

async function assertOwnsCourse(admin, courseId) {
  const Course = mongoose.model('Course');
  if (!mongoose.isValidObjectId(courseId)) return null;
  const course = await Course.findOne({ _id: courseId, removed: false });
  if (!course) return null;
  if (isManager(admin)) return course;
  if (isTeacher(admin) && course.instructor && rxEq(course.instructor).test(admin.name || '')) return course;
  return null;
}

async function getRule(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return bad(res, 403, 'Not your course.');
  const EligibilityRule = mongoose.model('EligibilityRule');
  const rule = await EligibilityRule.findOne({ course: course._id, removed: { $ne: true } }).lean();
  return ok(
    res,
    rule
      ? { ...rule, id: String(rule._id) }
      : { criteria: engine.DEFAULT_CRITERIA, overallThresholdPercent: 90, enabled: true, isDefault: true }
  );
}

async function upsertRule(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return bad(res, 403, 'Not your course.');
  const EligibilityRule = mongoose.model('EligibilityRule');
  const b = req.body || {};
  const criteria =
    Array.isArray(b.criteria) && b.criteria.length
      ? b.criteria.map((c) => ({
          key: c.key,
          label: c.label,
          enabled: c.enabled !== false,
          mandatory: !!c.mandatory,
          minPercent: clamp(c.minPercent, 0, 100, 0),
          weight: Math.max(0, Number(c.weight) || 1),
        }))
      : engine.DEFAULT_CRITERIA;

  const rule = await EligibilityRule.findOneAndUpdate(
    { course: course._id },
    {
      $set: {
        courseTitle: course.title,
        criteria,
        overallThresholdPercent: clamp(b.overallThresholdPercent, 0, 100, 90),
        enabled: b.enabled !== false,
        updated: new Date(),
      },
      $setOnInsert: { course: course._id, created: new Date() },
    },
    { upsert: true, new: true }
  );
  await auditLog.record({ module: 'eligibility', action: 'rule-save', entityType: 'EligibilityRule', entityId: rule._id, admin: req.admin, after: { criteria, threshold: rule.overallThresholdPercent } });
  return ok(res, { id: String(rule._id) }, 'Eligibility rule saved.');
}

async function courseReport(req, res) {
  const course = await assertOwnsCourse(req.admin, req.params.courseId);
  if (!course) return bad(res, 403, 'Not your course.');
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  const roster = await Student.find({ course: rxEq(course.title), removed: false }).select('email').lean();
  const emails = [...new Set(roster.map((r) => (r.email || '').toLowerCase()).filter(Boolean))];
  const admins = emails.length ? await Admin.find({ email: { $in: emails.map(rxEq) }, removed: false }).select('_id name email').lean() : [];
  const rows = [];
  for (const a of admins) {
    // eslint-disable-next-line no-await-in-loop
    const r = await engine.evaluate(a._id, course._id).catch(() => null);
    if (r) rows.push({ student: a.name, email: a.email, score: r.score, threshold: r.threshold, eligible: r.eligible, state: r.state, missing: r.missing });
  }
  return ok(res, rows);
}

async function myEligibility(req, res) {
  const rows = await engine.myEligibility(req.admin);
  return ok(res, rows);
}

module.exports = { getRule, upsertRule, courseReport, myEligibility };
