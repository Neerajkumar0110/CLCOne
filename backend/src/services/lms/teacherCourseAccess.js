const mongoose = require('mongoose');

const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

// A teacher's real course access is Batch.trainer (see services/lms/
// liveClassService.js, teacherDashboard in panel.js) — Course.instructor is
// a separate, free-typed field nothing else in the LMS keeps in sync, so a
// teacher who only ever got assigned through a batch (the normal path —
// Batches → pick a Teacher account) had no course.instructor match at all
// and every course-scoped controller that checked only that field (Doubts,
// Eligibility, Learner 360, Certificates, Curriculum Builder, Quizzes,
// Policies-via-course) threw "Not your course." even though their own
// Assignments/Projects/Live Classes/Students tabs plainly showed the batch.
// This is the shared "does this teacher actually own this course" check —
// true if either the legacy instructor field matches OR they train any
// batch built on this course.
async function isTeacherOfCourse(admin, course) {
  if (!course) return false;
  if (course.instructor && rxEq(course.instructor).test(admin.name || '')) return true;
  const Batch = mongoose.model('Batch');
  const viaBatch = await Batch.exists({ removed: false, course: course.title, trainer: rxEq(admin.name || '') });
  return !!viaBatch;
}

module.exports = { isTeacherOfCourse };
