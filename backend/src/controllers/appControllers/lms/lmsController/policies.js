const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES, LMS_STUDENT_ROLES, CRM_ADMIN_ROLES } = require('../../../../config/roles');
const realtime = require('../../../../services/lms/realtime');
const auditLog = require('../../../../services/lms/auditLog');
const { CATEGORIES } = require('../../../../config/lmsPolicyCategories');

// Policy & Acknowledgement Centre (spec §12).
//  manager only:
//   GET   /api/lms/policies?status=&category=          (latest-first per slug)
//   POST  /api/lms/policies                             { slug?,title,category,content,fileUrl,mandatory,audience,course,batch,effectiveDate }
//   GET   /api/lms/policies/:id
//   POST  /api/lms/policies/:id/publish                 (resolves roster -> creates pending acks -> notifies)
//   POST  /api/lms/policies/:id/archive
//   GET   /api/lms/policies/:id/report                  (per-student ack status)
//  student:
//   GET   /api/lms/my/policies                           (pending + acknowledged, for their own account)
//   POST  /api/lms/policies/:id/acknowledge

const isManager = (a) => !!(a && LMS_FULL_ACCESS_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
// approve + publish and delete: owner / Super Admin / Admin only — Support
// writes drafts and asks for approval (2026-11-27)
const isPolicyAdmin = (a) => !!(a && CRM_ADMIN_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

async function resolveRosterEmails({ audience, courseTitle, batch }) {
  const Student = mongoose.model('Student');
  const q = { removed: false };
  if (audience === 'course' && courseTitle) q.course = rxEq(courseTitle);
  if (audience === 'batch' && batch) q.batch = batch;
  const roster = await Student.find(q).select('email').lean();
  return [...new Set(roster.map((r) => (r.email || '').toLowerCase()).filter(Boolean))];
}

async function create(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return bad(res, 400, 'Title is required.');
  // a policy document is a PDF or a Word file only (LMS testing report #5)
  if (b.fileUrl && !/\.(pdf|docx?)(\?.*)?$/i.test(String(b.fileUrl))) return bad(res, 400, 'The policy document must be a PDF or Word (.doc / .docx) file.');
  const category = CATEGORIES.includes(b.category) ? b.category : 'Other';
  const slug = slugify(b.slug || title);
  const audience = ['all', 'course', 'batch'].includes(b.audience) ? b.audience : 'all';

  let course = null;
  if (audience === 'course' && mongoose.isValidObjectId(b.course)) {
    const Course = mongoose.model('Course');
    course = await Course.findById(b.course).lean();
    if (!course) return bad(res, 404, 'Internship not found.');
  }
  if (audience === 'batch' && !b.batch) return bad(res, 400, 'Batch name is required.');

  const PolicyDocument = mongoose.model('PolicyDocument');
  const last = await PolicyDocument.findOne({ slug }).sort({ version: -1 }).lean();
  const version = last ? last.version + 1 : 1;

  const doc = await PolicyDocument.create({
    slug,
    title,
    category,
    version,
    content: b.content || '',
    fileUrl: b.fileUrl || '',
    mandatory: b.mandatory !== false,
    audience,
    course: course ? course._id : undefined,
    courseTitle: course ? course.title : undefined,
    batch: audience === 'batch' ? b.batch : undefined,
    status: 'draft',
    effectiveDate: b.effectiveDate ? new Date(b.effectiveDate) : undefined,
    createdBy: req.admin._id,
    createdByName: req.admin.name,
    createdByRole: req.admin.role,
    byAdmin: isPolicyAdmin(req.admin),
  });

  await auditLog.record({
    module: 'policy',
    action: 'create',
    entityType: 'PolicyDocument',
    entityId: doc._id,
    admin: req.admin,
    after: { title, category, version },
  });
  // an Admin's own policy needs nobody's approval — it goes live for everyone now
  if (isPolicyAdmin(req.admin)) return publish({ admin: req.admin, params: { id: String(doc._id) }, body: {} }, res);
  return ok(res, { id: String(doc._id), version }, `Draft created (v${version}).`);
}

// Teachers get a read-only "Policies" tab (ViewPolicies in the frontend) —
// they only ever see published policies, never drafts/archived; a manager
// can filter by any status via ?status=.
async function list(req, res) {
  const PolicyDocument = mongoose.model('PolicyDocument');
  const q = { removed: false };
  if (!isManager(req.admin)) {
    q.status = 'published';
  } else if (req.query.status) {
    q.status = req.query.status;
  }
  if (req.query.category) q.category = req.query.category;
  const rows = await PolicyDocument.find(q).sort({ slug: 1, version: -1 }).limit(500).lean();
  return ok(res, rows.map((r) => ({ ...r, id: String(r._id) })));
}

async function getOne(req, res) {
  const PolicyDocument = mongoose.model('PolicyDocument');
  const doc = await PolicyDocument.findOne({ _id: req.params.id, removed: false }).lean();
  if (!doc) return bad(res, 404, 'Not found.');
  if (!isManager(req.admin) && doc.status !== 'published') return bad(res, 403, 'Not available.');
  return ok(res, { ...doc, id: String(doc._id) });
}

async function publish(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const Admin = mongoose.model('Admin');
  const doc = await PolicyDocument.findOne({ _id: req.params.id, removed: false });
  if (!doc) return bad(res, 404, 'Not found.');
  if (doc.status === 'published') return bad(res, 400, 'Already published.');
  // Support publishes only after the chosen Admin approved it; an Admin may publish directly
  if (!isPolicyAdmin(req.admin) && !doc.approvedAt) return bad(res, 403, 'An Admin has to approve this policy first — use “Send for approval”.');

  const emails = await resolveRosterEmails({ audience: doc.audience, courseTitle: doc.courseTitle, batch: doc.batch });
  const admins = emails.length
    ? await Admin.find({ email: { $in: emails.map(rxEq) }, removed: false }).select('_id name email').lean()
    : [];

  doc.status = 'published';
  if (!doc.approvedAt) {
    doc.approvedAt = new Date();
    doc.approvedBy = req.admin._id;
    doc.approvedByName = req.admin.name || req.admin.email;
  }
  doc.rejectedAt = undefined;
  doc.rejectNote = undefined;
  doc.rejectedByName = undefined;
  doc.publishedAt = new Date();
  doc.publishedBy = req.admin._id;
  doc.effectiveDate = doc.effectiveDate || new Date();
  doc.recipientsCount = admins.length;
  doc.updated = new Date();
  await doc.save();

  let created = 0;
  for (const a of admins) {
    try {
      await PolicyAcknowledgement.create({
        policy: doc._id,
        policySlug: doc.slug,
        policyTitle: doc.title,
        policyVersion: doc.version,
        student: a._id,
        studentName: a.name,
        studentEmail: a.email,
        status: 'pending',
      });
      created += 1;
    } catch (e) {
      // duplicate (policy, student) row — already pending/acknowledged for this exact version
    }
  }

  if (admins.length) {
    await realtime.notify(admins.map((a) => a._id), {
      type: 'lms.policy.published',
      title: `📄 New policy to acknowledge: ${doc.title}`,
      body: doc.mandatory ? 'This acknowledgement is mandatory.' : 'Please review when you can.',
      link: '/learn/policies',
      actorName: req.admin.name,
    });
    realtime.broadcast('lms:policy', { title: doc.title, scope: doc.audience === 'all' ? 'all' : doc.audience === 'batch' ? doc.batch : doc.courseTitle });
    try {
      const mailer = require('../../../../services/lms/mailer');
      const vars = { policyTitle: doc.title, version: doc.version, mandatory: !!doc.mandatory };
      await mailer.sendMail(emails, { ...require('../../../../services/mail/inlineEmails').policyPublished(vars), templateKey: 'lms-policy-published', vars });
    } catch (e) {
      /* non-fatal */
    }
  }

  const tell = [doc.approvalRequestedBy, doc.approvedBy].filter((x) => x && String(x) !== String(req.admin._id));
  if (tell.length) {
    await realtime.notify(tell, {
      type: 'lms.policy.published.staff',
      title: `📢 Policy published: ${doc.title}`,
      body: `${req.admin.name || 'Support'} published v${doc.version} · it is live for learners.`,
      link: '/lms/policies?view=publish',
      actorName: req.admin.name,
    });
  }

  await auditLog.record({
    module: 'policy',
    action: 'publish',
    entityType: 'PolicyDocument',
    entityId: doc._id,
    admin: req.admin,
    after: { recipients: admins.length, version: doc.version },
  });
  return ok(res, { id: String(doc._id), recipients: admins.length, created }, `Published to ${admins.length} candidate(s).`);
}

async function archive(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const doc = await PolicyDocument.findOne({ _id: req.params.id, removed: false });
  if (!doc) return bad(res, 404, 'Not found.');
  doc.status = 'archived';
  doc.archivedAt = new Date();
  doc.updated = new Date();
  await doc.save();
  await auditLog.record({ module: 'policy', action: 'archive', entityType: 'PolicyDocument', entityId: doc._id, admin: req.admin });
  return ok(res, {}, 'Archived.');
}

// DELETE /api/lms/policies/:id  (manager only) — distinct from archive:
// archive just stops a published policy from being pushed to new candidates
// while keeping the acknowledgement trail; this removes the document row
// itself (soft-delete, same as everywhere else in this app).
async function remove(req, res) {
  if (!isPolicyAdmin(req.admin)) return bad(res, 403, 'Only an Admin can delete a policy.');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const doc = await PolicyDocument.findOne({ _id: req.params.id, removed: false });
  if (!doc) return bad(res, 404, 'Not found.');
  // 2026-11-27: delete = gone for everyone — every version of this policy
  // (same slug) and every learner's acknowledgement row, so it leaves the
  // learner consent page and no longer locks anyone's LMS. Soft-delete, so
  // the audit trail can still be recovered from the DB.
  const now = new Date();
  const versions = await PolicyDocument.find({ slug: doc.slug, removed: false }).select('_id').lean();
  const ids = versions.map((v) => v._id);
  await PolicyDocument.updateMany({ _id: { $in: ids } }, { $set: { removed: true, updated: now } });
  const acks = await mongoose.model('PolicyAcknowledgement').updateMany({ policy: { $in: ids }, removed: { $ne: true } }, { $set: { removed: true, updated: now } });
  await auditLog.record({ module: 'policy', action: 'delete', entityType: 'PolicyDocument', entityId: doc._id, admin: req.admin, before: { title: doc.title, status: doc.status, versions: ids.length, acknowledgements: acks.modifiedCount || 0 } });
  realtime.broadcast('lms:policy', { title: doc.title, removed: true });
  return ok(res, { id: String(doc._id), versions: ids.length, learners: acks.modifiedCount || 0 }, `Policy deleted for everyone (${ids.length} version${ids.length === 1 ? '' : 's'}, ${acks.modifiedCount || 0} learner record${acks.modifiedCount === 1 ? '' : 's'}).`);
}

async function acknowledgementReport(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const rows = await PolicyAcknowledgement.find({ policy: req.params.id, removed: { $ne: true } })
    .sort({ status: 1, studentName: 1 })
    .lean();
  const acknowledged = rows.filter((r) => r.status === 'acknowledged').length;
  const outRows = rows.map((r) => ({
    id: String(r._id),
    student: r.studentName,
    email: r.studentEmail,
    status: r.status,
    acknowledgedAt: r.acknowledgedAt,
    remindedCount: r.remindedCount,
  }));

  // Spec §16 "Policy acknowledgement report" export — previously JSON-only,
  // same CSV/XLSX shape as liveScope.js's attendanceExport / learner360.js's
  // courseReportExport.
  const format = String(req.query.format || '').toLowerCase();
  if (format === 'csv' || format === 'xlsx') {
    const headers = ['Candidate', 'Email', 'Status', 'Acknowledged At', 'Reminded Count'];
    const line = (r) =>
      [r.student, r.email, r.status, r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : '', r.remindedCount]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',');
    if (format === 'xlsx') {
      try {
        const XLSX = require('xlsx');
        const ws = XLSX.utils.json_to_sheet(outRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Acknowledgements');
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="policy-acknowledgements.xlsx"');
        return res.status(200).send(buf);
      } catch (e) {
        // fall through to csv
      }
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="policy-acknowledgements.csv"');
    return res.status(200).send([headers.join(','), ...outRows.map(line)].join('\n'));
  }

  return ok(res, { total: rows.length, acknowledged, pending: rows.length - acknowledged, rows: outRows });
}

async function myPolicies(req, res) {
  if (!isStudent(req.admin) && !isManager(req.admin)) return bad(res, 403, 'Not available.');
  await ensurePolicyRows(req.admin).catch(() => {});
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const rows = await PolicyAcknowledgement.find({ student: req.admin._id, removed: { $ne: true } })
    .sort({ status: 1, created: -1 })
    .lean();
  const docs = await PolicyDocument.find({ _id: { $in: rows.map((r) => r.policy) } })
    .select('title category content fileUrl fileText mandatory version effectiveDate status')
    .lean();
  // PDF → readable text for the consent modal (best-effort, cached on the doc)
  const policyText = require('../../../../services/lms/policyText');
  await Promise.all(docs.map(async (d) => { d.fileText = await policyText.textFor(d).catch(() => d.fileText || ''); }));
  const byId = Object.fromEntries(docs.map((d) => [String(d._id), d]));
  return ok(
    res,
    rows.map((r) => {
      const d = byId[String(r.policy)] || {};
      return {
        id: String(r._id),
        policyId: String(r.policy),
        title: r.policyTitle,
        category: d.category,
        content: d.content,
        // learners read text only — the PDF itself stays with staff (2026-11-27)
        fileUrl: isStudent(req.admin) ? '' : d.fileUrl,
        fileText: d.content && String(d.content).trim() ? '' : d.fileText || '',
        mandatory: d.mandatory,
        version: r.policyVersion,
        effectiveDate: d.effectiveDate,
        status: r.status,
        acknowledgedAt: r.acknowledgedAt,
        openedAt: r.openedAt,
      };
    })
  );
}

// POST /api/lms/my/policies/:id/open — the learner opened this policy's text.
// Only the first open is kept; it never changes the acknowledgement itself.
async function markOpened(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  await PolicyAcknowledgement.updateOne(
    { policy: req.params.id, student: req.admin._id, removed: { $ne: true }, openedAt: null },
    { $set: { openedAt: new Date() } }
  );
  return ok(res, null);
}

// How many mandatory, published, already-effective policies this learner
// still has to acknowledge. Drives the server gate below and the panel's
// redirect to the consent page.
// A learner who joined after a policy was published had no acknowledgement
// row, so the T&C prompt never reached them (LMS testing report #5 "new
// learners"). Every published mandatory policy that applies to this learner
// (all / their internship / their batch) gets a pending row on first look.
// Checked at most every 5 minutes per learner.
const ensuredAt = new Map();
async function ensurePolicyRows(admin) {
  if (!isStudent(admin) || !admin.email) return;
  const key = String(admin._id);
  if (Date.now() - (ensuredAt.get(key) || 0) < 5 * 60 * 1000) return;
  ensuredAt.set(key, Date.now());
  const roster = await mongoose.model('Student').find({ removed: { $ne: true }, email: rxEq(admin.email) }).select('course batch').lean();
  if (!roster.length) return;
  const titles = [...new Set(roster.map((r) => r.course).filter(Boolean))];
  const batches = [...new Set(roster.map((r) => r.batch).filter(Boolean))];
  const PolicyDocument = mongoose.model('PolicyDocument');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const docs = await PolicyDocument.find({
    removed: { $ne: true },
    status: 'published',
    mandatory: true,
    $or: [{ audience: 'all' }, { audience: 'course', courseTitle: { $in: titles.map(rxEq) } }, { audience: 'batch', batch: { $in: batches } }],
  })
    .select('slug title version')
    .lean();
  if (!docs.length) return;
  const have = new Set((await PolicyAcknowledgement.distinct('policy', { student: admin._id, policy: { $in: docs.map((d) => d._id) } })).map(String));
  for (const d of docs.filter((x) => !have.has(String(x._id)))) {
    // eslint-disable-next-line no-await-in-loop
    await PolicyAcknowledgement.create({ policy: d._id, policySlug: d.slug, policyTitle: d.title, policyVersion: d.version, student: admin._id, studentName: admin.name, studentEmail: admin.email, status: 'pending' }).catch(() => {});
  }
}

async function pendingMandatoryCount(admin) {
  if (!isStudent(admin)) return 0;
  await ensurePolicyRows(admin).catch(() => {});
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const pending = await PolicyAcknowledgement.find({ student: admin._id, status: 'pending', removed: { $ne: true } }).select('policy').lean();
  if (!pending.length) return 0;
  const now = new Date();
  return PolicyDocument.countDocuments({
    _id: { $in: pending.map((p) => p.policy) },
    removed: { $ne: true },
    status: 'published',
    mandatory: true,
    $or: [{ effectiveDate: null }, { effectiveDate: { $lte: now } }],
  });
}

// Route guard for what the consent page promises stays locked until every
// mandatory policy is accepted: live classes, recordings, tests, projects.
// Staff are never gated; support, policies and the dashboard stay open.
async function requirePoliciesAccepted(req, res, next) {
  try {
    if (!isStudent(req.admin)) return next();
    const n = await pendingMandatoryCount(req.admin);
    if (!n) {
      // optional feedback lock (Admin & Ops › Rules) — report #10
      if (await require('./feedback').feedbackOverdue(req.admin).catch(() => false)) {
        return res.status(403).json({ success: false, result: null, code: 'FEEDBACK_PENDING', message: 'Please send this week\'s feedback first (Weekly feedback) — it unlocks at once.' });
      }
      return next();
    }
    return res.status(403).json({
      success: false,
      result: null,
      code: 'POLICY_PENDING',
      message: `Please accept your pending polic${n === 1 ? 'y' : 'ies'} first (My Policies).`,
    });
  } catch (e) {
    return next(); // never lock learners out because the check itself failed
  }
}

async function acknowledge(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const row = await PolicyAcknowledgement.findOne({ policy: req.params.id, student: req.admin._id, removed: { $ne: true } });
  if (!row) return bad(res, 404, 'No acknowledgement pending for you on this policy.');
  if (row.status === 'acknowledged') return ok(res, { id: String(row._id) }, 'Already acknowledged.');

  row.status = 'acknowledged';
  row.acknowledgedAt = new Date();
  row.ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  row.deviceInfo = String(req.headers['user-agent'] || '').slice(0, 300);
  row.updated = new Date();
  await row.save();
  await PolicyDocument.updateOne({ _id: row.policy }, { $inc: { acknowledgedCount: 1 } });

  await auditLog.record({
    module: 'policy',
    action: 'acknowledge',
    entityType: 'PolicyAcknowledgement',
    entityId: row._id,
    admin: req.admin,
    after: { version: row.policyVersion },
  });
  return ok(res, { id: String(row._id) }, 'Acknowledged.');
}

module.exports = {
  ensurePolicyRows,
  create,
  list,
  getOne,
  publish,
  archive,
  remove,
  acknowledgementReport,
  myPolicies,
  acknowledge,
  markOpened,
  pendingMandatoryCount,
  requirePoliciesAccepted,
  CATEGORIES,
};
