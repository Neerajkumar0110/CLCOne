const engine = require('../../../../services/lms/eligibilityEngine');

// Spec §3 "Learner Portal — every learner should have a single dashboard
// showing their complete academic and placement-readiness record, with an
// 'Overall Eligibility/Progress' card at top." Every piece of this data
// already existed (attendance, assessments, quizzes, projects, policies,
// certificates, notifications, eligibility) but was scattered across ~9
// separate endpoints/nav pages with no unified "home" view — and the one
// place that DID combine metrics into one row (learner360.js) was admin/
// teacher-only, never callable by the student about themselves.
//
// This file adds NO new business logic — it calls each existing handler's
// own function (via callAsJson, since they're Express (req,res) handlers
// that write directly to res) and reassembles the results into one payload,
// exactly the same "reuse via a fake res" pattern liveScope.js's
// attendanceExport already uses to reuse attendanceDashboard.
function callAsJson(fn, req) {
  return new Promise((resolve) => {
    const fakeRes = {
      _status: 200,
      status(code) {
        this._status = code;
        return this;
      },
      json(x) {
        resolve({ status: this._status, body: x });
        return this;
      },
    };
    Promise.resolve(fn(req, fakeRes)).catch((e) => resolve({ status: 500, body: { success: false, message: e.message } }));
  });
}

function unwrap(settled, fallback) {
  return settled && settled.body && settled.body.success ? settled.body.result : fallback;
}

// GET /api/lms/my/overview
async function myOverview(req, res) {
  const req2 = req; // same request object, reused across every sub-call

  const [eligibilityList, attendance, results, quizzes, projects, policies, certificates, updates] = await Promise.all([
    engine.myEligibility(req.admin).catch(() => []),
    callAsJson(require('./liveScope').studentAttendance, req2),
    callAsJson(require('./assessments').getMyResults, req2),
    callAsJson(require('./quizzes').myQuizzes, req2),
    callAsJson(require('./projects').myProjects, req2),
    callAsJson(require('./policies').myPolicies, req2),
    callAsJson(require('./certificates').mine, req2),
    callAsJson(require('./panel').myUpdates, req2),
  ]);

  // A student is normally enrolled in one active course at a time — surface
  // that one as the headline "Overall Eligibility/Progress" card, but keep
  // the full list too (myEligibility already covers every course they've
  // ever had a Student roster row for).
  const primary = eligibilityList[0] || null;

  return res.status(200).json({
    success: true,
    result: {
      eligibility: primary
        ? { score: primary.score, threshold: primary.threshold, eligible: primary.eligible, state: primary.state, missing: primary.missing, items: primary.items, course: primary.course }
        : null,
      eligibilityByCourse: eligibilityList,
      attendance: unwrap(attendance, null),
      assessments: unwrap(results, null),
      quizzes: unwrap(quizzes, null),
      projects: unwrap(projects, null),
      policies: unwrap(policies, null),
      certificates: unwrap(certificates, null),
      notifications: unwrap(updates, null),
    },
  });
}

// GET /api/lms/my/data-export — spec §17 "data export ... workflows should
// follow the organization's approved privacy policy" — a learner's own full
// data bundle as JSON, reusing the exact same aggregation as myOverview plus
// their raw profile fields. This is the mechanical "download my data"
// capability; what to do with the request legally is a policy decision the
// org makes separately.
async function exportMyData(req, res) {
  const overview = await new Promise((resolve) => {
    myOverview(req, { status: () => ({ json: (x) => resolve(x) }) });
  });
  return res.status(200).json({
    success: true,
    result: {
      profile: { name: req.admin.name, email: req.admin.email, role: req.admin.role },
      exportedAt: new Date(),
      ...(overview && overview.result),
    },
  });
}

// POST /api/lms/my/data-deletion-request — records the request and notifies
// management; does NOT delete anything automatically (see the Admin.js model
// comment on dataDeletionRequestedAt for why).
async function requestDataDeletion(req, res) {
  const mongoose = require('mongoose');
  const Admin = mongoose.model('Admin');
  await Admin.updateOne({ _id: req.admin._id }, { $set: { dataDeletionRequestedAt: new Date() } });
  try {
    await require('../../../../notify').notify({
      audience: 'management',
      module: 'Security',
      type: 'data.deletion.requested',
      title: `Data deletion requested by ${req.admin.name}`,
      body: `${req.admin.email} has requested their data be deleted. Review academic/financial retention requirements before acting.`,
      link: '/user-management',
    });
  } catch (e) {
    /* best-effort */
  }
  return res.status(200).json({ success: true, message: 'Your request has been recorded. Our team will follow up.' });
}

module.exports = { myOverview, exportMyData, requestDataDeletion };
