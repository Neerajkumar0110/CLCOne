const mongoose = require('mongoose');
const { getMoodleClient, publicLmsConfig, queue, roleMap } = require('../../../services/lms');

// Student-portal read endpoints. All behind the CRM bearer gate, all scoped
// to req.admin. They compose the LmsEnrolment projection (fast, always
// available) with live Moodle reads (enriched, may be degraded).

async function ensureUserMap(admin) {
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  let map = await MoodleUserMap.findOne({ crmUser: admin._id });
  if (!map || !map.moodleUserId) {
    // provisioning is async — the portal shows a "setting up" state
    await queue.enqueue('user.provision', { crmUserId: String(admin._id) }, { dedupeKey: `user.provision:${admin._id}` });
  }
  return map;
}

// GET /api/lms/portal/config
async function config(req, res) {
  return res.status(200).json({ success: true, result: publicLmsConfig() });
}

// GET /api/lms/portal/me
async function me(req, res) {
  const admin = req.admin;
  const map = await ensureUserMap(admin);
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const Certificate = mongoose.model('Certificate');

  const [active, completed, certs] = await Promise.all([
    LmsEnrolment.countDocuments({ crmUser: admin._id, status: 'active' }),
    LmsEnrolment.countDocuments({ crmUser: admin._id, completedOn: { $ne: null } }),
    Certificate.countDocuments({ student: admin.name, status: { $in: ['Issued', 'Sent'] } }),
  ]);

  return res.status(200).json({
    success: true,
    result: {
      user: {
        id: admin._id,
        name: `${admin.name || ''} ${admin.surname || ''}`.trim(),
        email: admin.email,
        photo: admin.photo || null,
        role: admin.role,
        lmsRole: roleMap.lmsRoleForCrm(admin.role),
        portal: roleMap.portalFor(admin.role),
      },
      moodle: {
        linked: !!(map && map.moodleUserId),
        provisioning: !(map && map.moodleUserId),
        syncStatus: map ? map.syncStatus : 'pending',
      },
      counts: { activeCourses: active, completedCourses: completed, certificates: certs },
    },
  });
}

// GET /api/lms/portal/my-courses
async function myCourses(req, res) {
  const admin = req.admin;
  const map = await ensureUserMap(admin);
  const LmsEnrolment = mongoose.model('LmsEnrolment');

  const enrolments = await LmsEnrolment.find({ crmUser: admin._id, status: { $in: ['active', 'pending'] } })
    .populate('crmCourse')
    .sort({ lastActivityAt: -1, created: -1 })
    .lean();

  // enrich with live Moodle course meta when we can
  let moodleCourses = [];
  const client = getMoodleClient();
  if (client.configured && map && map.moodleUserId) {
    try {
      moodleCourses = await client.getUsersCourses(map.moodleUserId);
    } catch (e) {
      /* degraded — fall back to the mirror */
    }
  }
  const byId = new Map(moodleCourses.map((c) => [c.id, c]));

  const courses = enrolments.map((e) => {
    const mc = byId.get(e.moodleCourseId);
    return {
      enrolmentId: e._id,
      moodleCourseId: e.moodleCourseId,
      title: (mc && mc.fullname) || (e.crmCourse && e.crmCourse.title) || `Course ${e.moodleCourseId}`,
      thumbnailUrl: (e.crmCourse && e.crmCourse.thumbnailUrl) || null,
      progressPct: mc && typeof mc.progress === 'number' ? mc.progress : e.progressPct || 0,
      completedOn: e.completedOn || null,
      lastActivityAt: e.lastActivityAt || null,
      source: e.source,
      batch: e.batch || null,
    };
  });

  return res.status(200).json({ success: true, result: { degraded: client.configured && !moodleCourses.length && !!enrolments.length ? false : !client.configured, courses } });
}

// GET /api/lms/portal/course/:moodleCourseId
async function course(req, res) {
  const admin = req.admin;
  const map = await mongoose.model('MoodleUserMap').findOne({ crmUser: admin._id });
  const moodleCourseId = Number(req.params.moodleCourseId);
  const LmsEnrolment = mongoose.model('LmsEnrolment');

  const enr = await LmsEnrolment.findOne({ crmUser: admin._id, moodleCourseId }).lean();
  if (!enr) return res.status(403).json({ success: false, message: 'Not enrolled in this course.' });

  const client = getMoodleClient();
  let contents = [];
  let completion = null;
  if (client.configured && map && map.moodleUserId) {
    try {
      contents = await client.getContents(moodleCourseId);
    } catch (e) {
      /* degraded */
    }
    try {
      completion = await client.getCourseCompletionStatus(moodleCourseId, map.moodleUserId);
    } catch (e) {
      /* not enabled or degraded */
    }
  }

  return res.status(200).json({
    success: true,
    result: {
      moodleCourseId,
      enrolment: {
        progressPct: enr.progressPct || 0,
        completedOn: enr.completedOn || null,
        finalGrade: enr.finalGrade ?? null,
        timeend: enr.timeend || null,
      },
      sections: contents,
      completion,
      degraded: !client.configured || !contents.length,
    },
  });
}

// GET /api/lms/portal/calendar?from=<unix>&to=<unix>
async function calendar(req, res) {
  const client = getMoodleClient();
  if (!client.configured) {
    return res.status(200).json({ success: true, result: { events: [], degraded: true } });
  }
  const from = Number(req.query.from) || Math.floor(Date.now() / 1000);
  const to = Number(req.query.to) || from + 30 * 86400;
  try {
    const data = await client.getCalendarEvents({ from, to });
    return res.status(200).json({ success: true, result: { events: (data && data.events) || [], degraded: false } });
  } catch (e) {
    return res.status(200).json({ success: true, result: { events: [], degraded: true, error: e.message } });
  }
}

module.exports = { config, me, myCourses, course, calendar };
