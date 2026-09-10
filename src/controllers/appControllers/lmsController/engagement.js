const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES, LMS_STUDENT_ROLES } = require('../../../config/roles');
const realtime = require('../../../services/lms/realtime');

// Doubts (course Q&A threads) + Announcements (targeted broadcasts).
//
//  doubts:
//   POST   /api/lms/doubts                     (student)  { course, lesson?, title, body }
//   GET    /api/lms/doubts?course=&status=     (teacher = own courses; student = own)
//   GET    /api/lms/doubts/:id
//   POST   /api/lms/doubts/:id/reply           { body, attachments? }
//   POST   /api/lms/doubts/:id/resolve
//   POST   /api/lms/doubts/:id/pin             (teacher, toggles)
//  announcements:
//   POST   /api/lms/announcements              (teacher/manager) { title, body, audience, course?, batch?, channels }
//   GET    /api/lms/announcements              (teacher = own)
//   DELETE /api/lms/announcements/:id
//   GET    /api/lms/my/announcements           (student feed)

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

async function teacherCourseIds(admin) {
  const Course = mongoose.model('Course');
  const rows = await Course.find({ removed: false, instructor: rxEq(admin.name || '') }).select('_id title').lean();
  return { ids: rows.map((c) => String(c._id)), byId: Object.fromEntries(rows.map((c) => [String(c._id), c.title])) };
}
async function studentCourseTitles(admin) {
  const Student = mongoose.model('Student');
  const rows = await Student.find({ removed: false, email: rxEq(admin.email || '') }).select('course batch').lean();
  return { titles: [...new Set(rows.map((r) => r.course).filter(Boolean))], batches: [...new Set(rows.map((r) => r.batch).filter(Boolean))] };
}
async function studentCourseIds(admin) {
  const { titles } = await studentCourseTitles(admin);
  if (!titles.length) return [];
  const Course = mongoose.model('Course');
  const rows = await Course.find({ removed: false, title: { $in: titles.map((t) => rxEq(t)) } }).select('_id').lean();
  return rows.map((c) => String(c._id));
}
async function canTeachCourse(admin, courseId) {
  if (isManager(admin)) return true;
  const { ids } = await teacherCourseIds(admin);
  return ids.includes(String(courseId));
}

/* ═══════════ DOUBTS ═══════════ */
async function askDoubt(req, res) {
  if (!isStudent(req.admin) && !isManager(req.admin)) return bad(res, 403, 'Students only.');
  const b = req.body || {};
  if (!mongoose.isValidObjectId(b.course)) return bad(res, 400, 'A course is required.');
  if (!isManager(req.admin)) {
    const ids = await studentCourseIds(req.admin);
    if (!ids.includes(String(b.course))) return bad(res, 403, 'You are not enrolled in this course.');
  }
  const Doubt = mongoose.model('Doubt');
  const doc = await Doubt.create({
    course: b.course,
    module: mongoose.isValidObjectId(b.module) ? b.module : undefined,
    chapter: mongoose.isValidObjectId(b.chapter) ? b.chapter : undefined,
    lesson: mongoose.isValidObjectId(b.lesson) ? b.lesson : undefined,
    student: req.admin._id,
    studentName: req.admin.name,
    studentEmail: req.admin.email,
    title: (b.title || 'Question').trim(),
    body: b.body || '',
    attachments: Array.isArray(b.attachments) ? b.attachments : [],
    status: 'open',
  });
  return ok(res, { id: String(doc._id) }, 'Question posted.');
}

async function listDoubts(req, res) {
  const Doubt = mongoose.model('Doubt');
  const Course = mongoose.model('Course');
  const q = { removed: false };
  if (mongoose.isValidObjectId(req.query.course)) q.course = req.query.course;
  if (req.query.status) q.status = req.query.status;

  if (isManager(req.admin)) {
    /* all */
  } else if (isTeacher(req.admin)) {
    const { ids } = await teacherCourseIds(req.admin);
    q.course = q.course ? q.course : { $in: ids };
  } else {
    q.student = req.admin._id;
  }
  const rows = await Doubt.find(q).sort({ pinned: -1, lastReplyAt: -1, created: -1 }).limit(300).lean();
  const courses = await Course.find({ _id: { $in: [...new Set(rows.map((r) => String(r.course)))] } }).select('title').lean();
  const cName = Object.fromEntries(courses.map((c) => [String(c._id), c.title]));
  return ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      title: r.title,
      body: r.body,
      course: cName[String(r.course)] || '',
      lesson: r.lesson ? String(r.lesson) : null,
      studentName: r.studentName,
      status: r.status,
      pinned: r.pinned,
      replyCount: (r.replies || []).length,
      lastReplyAt: r.lastReplyAt,
      created: r.created,
    }))
  );
}

async function getDoubt(req, res) {
  const Doubt = mongoose.model('Doubt');
  const d = await Doubt.findOne({ _id: req.params.id, removed: false }).lean();
  if (!d) return bad(res, 404, 'Not found.');
  const mine = String(d.student) === String(req.admin._id);
  const teaches = await canTeachCourse(req.admin, d.course);
  if (!mine && !teaches) return bad(res, 403, 'Not your question.');
  return ok(res, { ...d, id: String(d._id), canReply: mine || teaches, canModerate: teaches });
}

async function replyDoubt(req, res) {
  const Doubt = mongoose.model('Doubt');
  const d = await Doubt.findOne({ _id: req.params.id, removed: false });
  if (!d) return bad(res, 404, 'Not found.');
  const mine = String(d.student) === String(req.admin._id);
  const teaches = await canTeachCourse(req.admin, d.course);
  if (!mine && !teaches) return bad(res, 403, 'Not your question.');
  const body = String((req.body || {}).body || '').trim();
  if (!body) return bad(res, 400, 'Reply cannot be empty.');
  const byRole = teaches ? (isManager(req.admin) ? 'manager' : 'teacher') : 'student';
  d.replies.push({
    by: req.admin._id,
    byName: req.admin.name,
    byRole,
    body,
    attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
    at: new Date(),
  });
  d.lastReplyAt = new Date();
  if (byRole !== 'student' && d.status === 'open') d.status = 'answered';
  d.updated = new Date();
  await d.save();

  // real-time: notify the other side
  try {
    if (byRole === 'student') {
      const Course = mongoose.model('Course');
      const Admin = mongoose.model('Admin');
      const course = await Course.findById(d.course).select('instructor title').lean();
      if (course && course.instructor) {
        const t = await Admin.findOne({ name: rxEq(course.instructor), removed: false }).select('_id').lean();
        if (t) await realtime.notify([t._id], { type: 'lms.doubt.reply', title: `New reply on "${d.title}"`, body: body.slice(0, 160), link: '/teacher/doubts', actorName: req.admin.name });
      }
    } else {
      await realtime.notify([d.student], { type: 'lms.doubt.answered', title: `Your question "${d.title}" was answered`, body: body.slice(0, 160), link: '/learn/doubts', actorName: req.admin.name });
    }
  } catch (e) {
    /* non-fatal */
  }
  realtime.toUsers([d.student], 'lms:doubt', { id: String(d._id), status: d.status });

  return ok(res, { id: String(d._id), status: d.status }, 'Reply added.');
}

async function resolveDoubt(req, res) {
  const Doubt = mongoose.model('Doubt');
  const d = await Doubt.findOne({ _id: req.params.id, removed: false });
  if (!d) return bad(res, 404, 'Not found.');
  const mine = String(d.student) === String(req.admin._id);
  const teaches = await canTeachCourse(req.admin, d.course);
  if (!mine && !teaches) return bad(res, 403, 'Not your question.');
  d.status = req.body && req.body.reopen ? 'open' : 'resolved';
  d.updated = new Date();
  await d.save();
  return ok(res, { id: String(d._id), status: d.status }, `Marked ${d.status}.`);
}

async function pinDoubt(req, res) {
  const Doubt = mongoose.model('Doubt');
  const d = await Doubt.findOne({ _id: req.params.id, removed: false });
  if (!d) return bad(res, 404, 'Not found.');
  if (!(await canTeachCourse(req.admin, d.course))) return bad(res, 403, 'Teachers only.');
  d.pinned = !d.pinned;
  d.updated = new Date();
  await d.save();
  return ok(res, { id: String(d._id), pinned: d.pinned });
}

/* ═══════════ ANNOUNCEMENTS ═══════════ */
async function createAnnouncement(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Teachers only.');
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return bad(res, 400, 'Title is required.');
  const audience = ['all', 'course', 'batch'].includes(b.audience) ? b.audience : 'course';
  const channels = Array.isArray(b.channels) && b.channels.length ? b.channels.filter((c) => ['in_app', 'email'].includes(c)) : ['in_app'];

  const Course = mongoose.model('Course');
  const Student = mongoose.model('Student');
  const Admin = mongoose.model('Admin');
  const Announcement = mongoose.model('LmsAnnouncement');
  const Notification = mongoose.model('Notification');

  let course = null;
  if (audience !== 'all') {
    if (audience === 'course') {
      if (!mongoose.isValidObjectId(b.course)) return bad(res, 400, 'Pick a course.');
      course = await Course.findById(b.course).lean();
      if (!course) return bad(res, 404, 'Course not found.');
      if (!isManager(req.admin) && !(course.instructor && rxEq(course.instructor).test(req.admin.name || '')))
        return bad(res, 403, 'Not your course.');
    }
  }

  // resolve recipient roster rows -> emails
  const rq = { removed: false };
  if (audience === 'course' && course) rq.course = rxEq(course.title);
  if (audience === 'batch') {
    if (!b.batch) return bad(res, 400, 'Pick a batch.');
    rq.batch = b.batch;
  }
  const roster = await Student.find(rq).select('email name').lean();
  const emails = [...new Set(roster.map((r) => (r.email || '').toLowerCase()).filter(Boolean))];

  const ann = await Announcement.create({
    teacherCrmUser: req.admin._id,
    teacherName: req.admin.name,
    title,
    body: b.body || '',
    audience,
    course: course ? course._id : undefined,
    courseTitle: course ? course.title : undefined,
    batch: audience === 'batch' ? b.batch : undefined,
    channels,
    recipientsCount: emails.length,
    sentAt: new Date(),
  });

  // in-app notifications for recipients who have an Admin account
  let notified = 0;
  if (channels.includes('in_app') && emails.length) {
    const admins = await Admin.find({ email: { $in: emails }, removed: false }).select('_id').lean();
    if (admins.length) {
      const r = await realtime.notify(
        admins.map((a) => a._id),
        { type: 'lms.announcement', title: `📢 ${title}`, body: b.body || '', link: '/learn/notifications', actorName: req.admin.name }
      );
      notified = r.created || admins.length;
    }
  }
  realtime.broadcast('lms:announcement', { title, from: req.admin.name, scope: audience === 'all' ? 'all' : audience === 'batch' ? b.batch : (course && course.title) });

  let emailed = 0;
  if (channels.includes('email') && emails.length) {
    try {
      const mailer = require('../../../services/lms/mailer');
      const r = await mailer.sendMail(emails, {
        subject: `📢 ${title}`,
        html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>${escapeHtml(title)}</h2>
          <p style="white-space:pre-wrap">${escapeHtml(b.body || '')}</p>
          <p style="color:#667085;font-size:13px">— ${escapeHtml(req.admin.name)}${course ? ' · ' + escapeHtml(course.title) : ''}</p>
        </div>`,
      });
      emailed = r.sent || 0;
    } catch (e) {
      /* non-fatal */
    }
  }
  ann.emailedCount = emailed;
  await ann.save();

  return ok(res, { id: String(ann._id), recipients: emails.length, notified, emailed }, 'Announcement sent.');
}

async function listAnnouncements(req, res) {
  const Announcement = mongoose.model('LmsAnnouncement');
  const q = { removed: false };
  if (!isManager(req.admin)) q.teacherCrmUser = req.admin._id;
  const rows = await Announcement.find(q).sort({ sentAt: -1 }).limit(200).lean();
  return ok(res, rows.map((r) => ({ ...r, id: String(r._id) })));
}

async function deleteAnnouncement(req, res) {
  const Announcement = mongoose.model('LmsAnnouncement');
  const a = await Announcement.findOne({ _id: req.params.id, removed: false });
  if (!a) return bad(res, 404, 'Not found.');
  if (!isManager(req.admin) && String(a.teacherCrmUser) !== String(req.admin._id)) return bad(res, 403, 'Not yours.');
  a.removed = true;
  a.updated = new Date();
  await a.save();
  return ok(res, {}, 'Removed.');
}

async function myAnnouncements(req, res) {
  const Announcement = mongoose.model('LmsAnnouncement');
  const { titles, batches } = await studentCourseTitles(req.admin);
  const Course = mongoose.model('Course');
  const courses = titles.length ? await Course.find({ title: { $in: titles.map((t) => rxEq(t)) }, removed: false }).select('_id').lean() : [];
  const courseIds = courses.map((c) => c._id);
  const rows = await Announcement.find({
    removed: false,
    $or: [{ audience: 'all' }, { audience: 'course', course: { $in: courseIds } }, { audience: 'batch', batch: { $in: batches } }],
  }).sort({ sentAt: -1 }).limit(100).lean();
  return ok(
    res,
    rows.map((r) => ({
      id: String(r._id),
      title: r.title,
      body: r.body,
      from: r.teacherName,
      scope: r.audience === 'all' ? 'All students' : r.audience === 'batch' ? r.batch : r.courseTitle,
      sentAt: r.sentAt,
    }))
  );
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

module.exports = {
  askDoubt, listDoubts, getDoubt, replyDoubt, resolveDoubt, pinDoubt,
  createAnnouncement, listAnnouncements, deleteAnnouncement, myAnnouncements,
};
