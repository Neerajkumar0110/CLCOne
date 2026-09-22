const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, LMS_TEACHER_ROLES, LMS_STUDENT_ROLES } = require('../../../../config/roles');
const realtime = require('../../../../services/lms/realtime');
const auditLog = require('../../../../services/lms/auditLog');

// Project Management Module (spec §10). Confidentiality is enforced here,
// not in the schema: only the owning student, the assigned mentor and a
// management role may read/write a given project — never another student.
//
//  assign (manager, or the course's teacher):
//   POST   /api/lms/projects                    { course, studentEmail, mentorEmail?, title, problemStatement, scope, dueDate?, milestones?, rubric? }
//   GET    /api/lms/projects?course=&status=     (manager: all; teacher/mentor: own)
//   GET    /api/lms/projects/:id
//   PATCH  /api/lms/projects/:id                 (mentor/manager — title/scope/milestones/dueDate/mentor/rubric)
//   POST   /api/lms/projects/:id/milestones      { index, status }   (owner student or mentor/manager)
//  student (owner only):
//   POST   /api/lms/projects/:id/submit          { note, githubUrl, deploymentUrl, files? }
//   GET    /api/lms/my/projects
//  mentor/manager:
//   POST   /api/lms/projects/:id/review          { decision, feedback, rubricScores? }
//   GET    /api/lms/teacher/projects

const isManager = (a) => !!(a && MANAGEMENT_ROLES.includes(a.role));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const gradeFor = (pct) => (pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : 'Pass');

function canAccess(admin, project) {
  if (isManager(admin)) return true;
  if (String(project.student) === String(admin._id)) return true;
  if (project.mentor && String(project.mentor) === String(admin._id)) return true;
  return false;
}
function canManage(admin, project) {
  return isManager(admin) || (project.mentor && String(project.mentor) === String(admin._id));
}

function summarize(p) {
  return {
    id: String(p._id),
    course: p.courseTitle,
    courseId: String(p.course),
    student: p.studentName,
    studentEmail: p.studentEmail,
    mentor: p.mentorName,
    title: p.title,
    status: p.status,
    dueDate: p.dueDate,
    currentVersion: p.currentVersion,
    finalScore: p.finalScore,
    finalGrade: p.finalGrade,
    githubUrl: p.githubUrl,
    deploymentUrl: p.deploymentUrl,
    updated: p.updated,
  };
}

async function assign(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Not allowed.');
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.course)) return bad(res, 400, 'A course is required.');
  const title = String(b.title || '').trim();
  if (!title) return bad(res, 400, 'Title is required.');

  const Course = mongoose.model('Course');
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  const Project = mongoose.model('Project');

  const course = await Course.findOne({ _id: b.course, removed: false }).lean();
  if (!course) return bad(res, 404, 'Course not found.');
  if (isTeacher(req.admin) && !(course.instructor && rxEq(course.instructor).test(req.admin.name || '')))
    return bad(res, 403, 'Not your course.');

  if (!b.studentEmail) return bad(res, 400, 'Student email is required.');
  const roster = await Student.findOne({ email: rxEq(b.studentEmail), course: rxEq(course.title), removed: false }).lean();
  if (!roster) return bad(res, 404, 'That student is not enrolled in this course.');
  const student = await Admin.findOne({ email: rxEq(b.studentEmail), removed: false }).select('_id name email').lean();
  if (!student) return bad(res, 404, 'Student has no login account yet.');

  let mentor = null;
  if (b.mentorEmail) {
    mentor = await Admin.findOne({ email: rxEq(b.mentorEmail), role: 'Teacher', removed: false }).select('_id name email').lean();
    if (!mentor) return bad(res, 404, 'Mentor not found (must be a Teacher account).');
  } else if (course.instructor) {
    mentor = await Admin.findOne({ name: rxEq(course.instructor), role: 'Teacher', removed: false }).select('_id name email').lean();
  }

  const milestones = Array.isArray(b.milestones)
    ? b.milestones.map((m) => ({ title: m.title, dueDate: m.dueDate ? new Date(m.dueDate) : undefined, status: 'pending' }))
    : [];
  const rubric = Array.isArray(b.rubric) && b.rubric.length
    ? b.rubric.map((r) => ({ criterion: r.criterion, maxMarks: Number(r.maxMarks) || 10 }))
    : [{ criterion: 'Functionality', maxMarks: 40 }, { criterion: 'Code quality', maxMarks: 20 }, { criterion: 'Documentation', maxMarks: 20 }, { criterion: 'Presentation', maxMarks: 20 }];

  let project;
  try {
    project = await Project.create({
      course: course._id,
      courseTitle: course.title,
      student: student._id,
      studentName: student.name,
      studentEmail: student.email,
      mentor: mentor ? mentor._id : undefined,
      mentorName: mentor ? mentor.name : undefined,
      title,
      problemStatement: b.problemStatement || '',
      scope: b.scope || '',
      dueDate: b.dueDate ? new Date(b.dueDate) : undefined,
      milestones,
      rubric,
      status: 'assigned',
      createdBy: req.admin._id,
    });
  } catch (e) {
    if (e.code === 11000) return bad(res, 409, 'This student already has a project for this course.');
    throw e;
  }

  await realtime.notify([student._id], {
    type: 'lms.project.assigned',
    title: `📁 New project assigned: ${title}`,
    body: `Course: ${course.title}${mentor ? ` · Mentor: ${mentor.name}` : ''}`,
    link: '/learn/projects',
    actorName: req.admin.name,
  });
  await auditLog.record({ module: 'project', action: 'assign', entityType: 'Project', entityId: project._id, admin: req.admin, after: { student: student.email, mentor: mentor && mentor.email } });
  return ok(res, { id: String(project._id) }, 'Project assigned.');
}

async function list(req, res) {
  const Project = mongoose.model('Project');
  const q = { removed: false };
  if (mongoose.isValidObjectId(req.query.course)) q.course = req.query.course;
  if (req.query.status) q.status = req.query.status;
  if (isManager(req.admin)) {
    /* all */
  } else if (isTeacher(req.admin)) {
    q.mentor = req.admin._id;
  } else {
    return bad(res, 403, 'Use /my/projects.');
  }
  const rows = await Project.find(q).sort({ updated: -1 }).limit(300).lean();
  return ok(res, rows.map(summarize));
}

async function myProjects(req, res) {
  if (!isStudent(req.admin) && !isManager(req.admin)) return bad(res, 403, 'Not available.');
  const Project = mongoose.model('Project');
  const rows = await Project.find({ student: req.admin._id, removed: false }).sort({ updated: -1 }).lean();
  return ok(res, rows.map((p) => ({ ...summarize(p), problemStatement: p.problemStatement, scope: p.scope, milestones: p.milestones, rubric: p.rubric, submissions: p.submissions })));
}

async function getOne(req, res) {
  const Project = mongoose.model('Project');
  const p = await Project.findOne({ _id: req.params.id, removed: false }).lean();
  if (!p) return bad(res, 404, 'Not found.');
  if (!canAccess(req.admin, p)) return bad(res, 403, 'Not your project.');
  return ok(res, { ...p, id: String(p._id) });
}

async function update(req, res) {
  const Project = mongoose.model('Project');
  const p = await Project.findOne({ _id: req.params.id, removed: false });
  if (!p) return bad(res, 404, 'Not found.');
  if (!canManage(req.admin, p)) return bad(res, 403, 'Not allowed.');
  const b = req.body || {};

  if (b.title !== undefined) p.title = String(b.title).trim() || p.title;
  if (b.problemStatement !== undefined) p.problemStatement = b.problemStatement;
  if (b.scope !== undefined) p.scope = b.scope;
  if (b.dueDate !== undefined) p.dueDate = b.dueDate ? new Date(b.dueDate) : undefined;
  if (Array.isArray(b.milestones)) {
    p.milestones = b.milestones.map((m) => ({
      title: m.title,
      dueDate: m.dueDate ? new Date(m.dueDate) : undefined,
      status: ['pending', 'in_progress', 'done'].includes(m.status) ? m.status : 'pending',
      completedAt: m.status === 'done' ? m.completedAt || new Date() : undefined,
    }));
  }
  if (Array.isArray(b.rubric) && b.rubric.length) {
    p.rubric = b.rubric.map((r) => ({ criterion: r.criterion, maxMarks: Number(r.maxMarks) || 10 }));
  }
  if (b.mentorEmail !== undefined && isManager(req.admin)) {
    const Admin = mongoose.model('Admin');
    const mentor = await Admin.findOne({ email: rxEq(b.mentorEmail), role: 'Teacher', removed: false }).select('_id name').lean();
    if (mentor) {
      p.mentor = mentor._id;
      p.mentorName = mentor.name;
    }
  }
  p.updated = new Date();
  await p.save();
  await auditLog.record({ module: 'project', action: 'update', entityType: 'Project', entityId: p._id, admin: req.admin });
  return ok(res, { id: String(p._id) }, 'Saved.');
}

async function updateMilestone(req, res) {
  const Project = mongoose.model('Project');
  const p = await Project.findOne({ _id: req.params.id, removed: false });
  if (!p) return bad(res, 404, 'Not found.');
  const isOwner = String(p.student) === String(req.admin._id);
  if (!isOwner && !canManage(req.admin, p)) return bad(res, 403, 'Not allowed.');
  const b = req.body || {};
  const idx = Number(b.index);
  if (!Number.isInteger(idx) || !p.milestones[idx]) return bad(res, 400, 'Invalid milestone.');
  if (!['pending', 'in_progress', 'done'].includes(b.status)) return bad(res, 400, 'Invalid status.');
  p.milestones[idx].status = b.status;
  p.milestones[idx].completedAt = b.status === 'done' ? new Date() : undefined;
  if (p.status === 'assigned' && b.status !== 'pending') p.status = 'in_progress';
  p.updated = new Date();
  await p.save();
  return ok(res, { id: String(p._id) }, 'Milestone updated.');
}

async function submit(req, res) {
  const Project = mongoose.model('Project');
  const p = await Project.findOne({ _id: req.params.id, removed: false });
  if (!p) return bad(res, 404, 'Not found.');
  if (String(p.student) !== String(req.admin._id)) return bad(res, 403, 'Only the project owner can submit.');
  if (p.status === 'approved') return bad(res, 400, 'Project already approved.');
  const b = req.body || {};

  const version = (p.currentVersion || 0) + 1;
  p.submissions.push({
    version,
    submittedAt: new Date(),
    note: b.note || '',
    githubUrl: b.githubUrl || '',
    deploymentUrl: b.deploymentUrl || '',
    files: Array.isArray(b.files) ? b.files.slice(0, 20) : [],
  });
  p.currentVersion = version;
  p.githubUrl = b.githubUrl || p.githubUrl;
  p.deploymentUrl = b.deploymentUrl || p.deploymentUrl;
  p.status = 'submitted';
  p.updated = new Date();
  await p.save();

  if (p.mentor) {
    await realtime.notify([p.mentor], {
      type: 'lms.project.submitted',
      title: `📤 ${p.studentName} submitted "${p.title}" (v${version})`,
      body: `Course: ${p.courseTitle}`,
      link: '/teacher/projects',
      actorName: req.admin.name,
    });
  }
  await auditLog.record({ module: 'project', action: 'submit', entityType: 'Project', entityId: p._id, admin: req.admin, after: { version } });
  return ok(res, { id: String(p._id), version }, 'Submitted for review.');
}

async function review(req, res) {
  const Project = mongoose.model('Project');
  const p = await Project.findOne({ _id: req.params.id, removed: false });
  if (!p) return bad(res, 404, 'Not found.');
  if (!canManage(req.admin, p)) return bad(res, 403, 'Not allowed.');
  if (!p.submissions.length) return bad(res, 400, 'Nothing submitted yet.');
  const b = req.body || {};
  if (!['approved', 'revision_requested', 'rejected'].includes(b.decision)) return bad(res, 400, 'Invalid decision.');

  const last = p.submissions[p.submissions.length - 1];
  const rubricScores = Array.isArray(b.rubricScores) ? b.rubricScores : [];
  const maxTotal = (p.rubric || []).reduce((a, r) => a + (r.maxMarks || 0), 0);
  const awardedTotal = rubricScores.reduce((a, r) => a + (Number(r.marks) || 0), 0);
  const totalScore = maxTotal > 0 ? Math.round((awardedTotal / maxTotal) * 100) : undefined;

  last.review = {
    by: req.admin._id,
    byName: req.admin.name,
    at: new Date(),
    decision: b.decision,
    feedback: b.feedback || '',
    rubricScores: rubricScores.map((r) => ({ criterion: r.criterion, marks: Number(r.marks) || 0 })),
    totalScore,
  };

  p.status = b.decision === 'approved' ? 'approved' : b.decision === 'rejected' ? 'rejected' : 'revision_requested';
  if (b.decision === 'approved') {
    p.finalScore = totalScore;
    p.finalGrade = totalScore != null ? gradeFor(totalScore) : undefined;
    p.approvedAt = new Date();
  }
  p.updated = new Date();
  await p.save();

  await realtime.notify([p.student], {
    type: 'lms.project.reviewed',
    title: b.decision === 'approved' ? `✅ Project approved: ${p.title}` : b.decision === 'rejected' ? `❌ Project rejected: ${p.title}` : `✏️ Revision requested: ${p.title}`,
    body: b.feedback || '',
    link: '/learn/projects',
    actorName: req.admin.name,
  });
  try {
    const mailer = require('../../../../services/lms/mailer');
    await mailer.sendMail([p.studentEmail], {
      subject: `Project review — ${p.title}: ${b.decision.replace('_', ' ')}`,
      html: `<p>Your project <b>${p.title}</b> was reviewed.</p><p>Decision: <b>${b.decision.replace('_', ' ')}</b></p>${b.feedback ? `<p>${b.feedback}</p>` : ''}`,
    });
  } catch (e) {
    /* non-fatal */
  }
  await auditLog.record({ module: 'project', action: 'review', entityType: 'Project', entityId: p._id, admin: req.admin, after: { decision: b.decision, totalScore } });
  return ok(res, { id: String(p._id), status: p.status, totalScore }, 'Review saved.');
}

module.exports = { assign, list, myProjects, getOne, update, updateMilestone, submit, review };
