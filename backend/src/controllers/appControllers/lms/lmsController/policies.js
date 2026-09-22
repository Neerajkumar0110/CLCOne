const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, LMS_STUDENT_ROLES } = require('../../../../config/roles');
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

const isManager = (a) => !!(a && MANAGEMENT_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
const escapeHtml = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  const category = CATEGORIES.includes(b.category) ? b.category : 'Other';
  const slug = slugify(b.slug || title);
  const audience = ['all', 'course', 'batch'].includes(b.audience) ? b.audience : 'all';

  let course = null;
  if (audience === 'course' && mongoose.isValidObjectId(b.course)) {
    const Course = mongoose.model('Course');
    course = await Course.findById(b.course).lean();
    if (!course) return bad(res, 404, 'Course not found.');
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
  });

  await auditLog.record({
    module: 'policy',
    action: 'create',
    entityType: 'PolicyDocument',
    entityId: doc._id,
    admin: req.admin,
    after: { title, category, version },
  });
  return ok(res, { id: String(doc._id), version }, `Draft created (v${version}).`);
}

async function list(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const q = { removed: false };
  if (req.query.status) q.status = req.query.status;
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

  const emails = await resolveRosterEmails({ audience: doc.audience, courseTitle: doc.courseTitle, batch: doc.batch });
  const admins = emails.length
    ? await Admin.find({ email: { $in: emails.map(rxEq) }, removed: false }).select('_id name email').lean()
    : [];

  doc.status = 'published';
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
      await mailer.sendMail(emails, {
        subject: `Action required: acknowledge "${doc.title}"`,
        html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>${escapeHtml(doc.title)}</h2>
          <p>Please sign in to the portal and acknowledge this ${doc.mandatory ? '<b>mandatory</b> ' : ''}policy (version ${doc.version}).</p>
        </div>`,
      });
    } catch (e) {
      /* non-fatal */
    }
  }

  await auditLog.record({
    module: 'policy',
    action: 'publish',
    entityType: 'PolicyDocument',
    entityId: doc._id,
    admin: req.admin,
    after: { recipients: admins.length, version: doc.version },
  });
  return ok(res, { id: String(doc._id), recipients: admins.length, created }, `Published to ${admins.length} student(s).`);
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

async function acknowledgementReport(req, res) {
  if (!isManager(req.admin)) return bad(res, 403, 'Management role required.');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const rows = await PolicyAcknowledgement.find({ policy: req.params.id, removed: { $ne: true } })
    .sort({ status: 1, studentName: 1 })
    .lean();
  const acknowledged = rows.filter((r) => r.status === 'acknowledged').length;
  return ok(res, {
    total: rows.length,
    acknowledged,
    pending: rows.length - acknowledged,
    rows: rows.map((r) => ({
      id: String(r._id),
      student: r.studentName,
      email: r.studentEmail,
      status: r.status,
      acknowledgedAt: r.acknowledgedAt,
      remindedCount: r.remindedCount,
    })),
  });
}

async function myPolicies(req, res) {
  if (!isStudent(req.admin) && !isManager(req.admin)) return bad(res, 403, 'Not available.');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const PolicyDocument = mongoose.model('PolicyDocument');
  const rows = await PolicyAcknowledgement.find({ student: req.admin._id, removed: { $ne: true } })
    .sort({ status: 1, created: -1 })
    .lean();
  const docs = await PolicyDocument.find({ _id: { $in: rows.map((r) => r.policy) } })
    .select('title category content fileUrl mandatory version effectiveDate status')
    .lean();
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
        fileUrl: d.fileUrl,
        mandatory: d.mandatory,
        version: r.policyVersion,
        effectiveDate: d.effectiveDate,
        status: r.status,
        acknowledgedAt: r.acknowledgedAt,
      };
    })
  );
}

async function acknowledge(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Students only.');
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

module.exports = { create, list, getOne, publish, archive, acknowledgementReport, myPolicies, acknowledge, CATEGORIES };
