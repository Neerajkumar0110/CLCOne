const mongoose = require('mongoose');
const { MANAGEMENT_ROLES, SUPER_ADMIN_ROLES, LMS_TEACHER_ROLES } = require('../../../../config/roles');
const { lmsConfig } = require('../../../../services/lms');

// Study Material — teacher-uploaded files (or a pasted link), scoped to a
// batch so a student only ever sees material for the batch they're actually
// enrolled in. Same shape as engagement.js's announcements (batch-owned,
// teacher manages own uploads, manager sees/manages everything).
//
//  POST   /api/lms/materials          (teacher/manager) multipart file + { batch, title?, subject? }
//  POST   /api/lms/materials/link     (teacher/manager) { batch, url, title?, subject? }
//  GET    /api/lms/materials          (teacher = own uploads; manager = all)
//  DELETE /api/lms/materials/:id
//  GET    /api/lms/my/materials       (student — own batch only)

const isManager = (a) => !!(a && (MANAGEMENT_ROLES.includes(a.role) || SUPER_ADMIN_ROLES.includes(a.role)));
const isTeacher = (a) => !!(a && LMS_TEACHER_ROLES.includes(a.role));
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });

function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}

function kindFromMime(mime, name) {
  const m = mime || '';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m === 'application/pdf' || /\.pdf$/i.test(name || '')) return 'pdf';
  return 'other';
}

async function assertOwnsBatch(admin, batch) {
  if (isManager(admin)) return true;
  const Batch = mongoose.model('Batch');
  return !!(await Batch.exists({ removed: false, name: batch, trainer: rxEq(admin.name || '') }));
}

function serialize(r) {
  return {
    id: String(r._id),
    title: r.title,
    subject: r.subject || '',
    batch: r.batch,
    kind: r.kind,
    sourceType: r.sourceType,
    fileUrl: r.fileUrl,
    originalName: r.originalName || '',
    mimeType: r.mimeType || '',
    sizeBytes: r.sizeBytes || 0,
    teacherName: r.teacherName,
    uploadedAt: r.uploadedAt,
  };
}

async function upload(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Teachers only.');
  const b = req.body || {};
  const batch = String(b.batch || '').trim();
  if (!batch) return bad(res, 400, 'Pick a batch.');
  if (!(await assertOwnsBatch(req.admin, batch))) return bad(res, 403, 'Not your batch.');
  if (!req.file) return bad(res, 400, 'No file uploaded.');

  const StudyMaterial = mongoose.model('StudyMaterial');
  const originalName = req.file.originalname;
  const title = (b.title && b.title.trim()) || originalName.replace(/\.[^.]+$/, '');

  const doc = await StudyMaterial.create({
    teacherCrmUser: req.admin._id,
    teacherName: req.admin.name,
    title,
    subject: (b.subject || '').trim(),
    batch,
    kind: kindFromMime(req.file.mimetype, originalName),
    sourceType: 'file',
    fileUrl: `${crmBase()}/${req.body.file}`,
    originalName,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
  return ok(res, serialize(doc), 'Uploaded.');
}

async function addLink(req, res) {
  if (!isManager(req.admin) && !isTeacher(req.admin)) return bad(res, 403, 'Teachers only.');
  const b = req.body || {};
  const batch = String(b.batch || '').trim();
  const url = String(b.url || '').trim();
  if (!batch) return bad(res, 400, 'Pick a batch.');
  if (!url) return bad(res, 400, 'Paste a URL.');
  if (!/^https?:\/\//i.test(url)) return bad(res, 400, 'Enter a valid http(s) URL.');
  if (!(await assertOwnsBatch(req.admin, batch))) return bad(res, 403, 'Not your batch.');

  const StudyMaterial = mongoose.model('StudyMaterial');
  const doc = await StudyMaterial.create({
    teacherCrmUser: req.admin._id,
    teacherName: req.admin.name,
    title: (b.title && b.title.trim()) || url,
    subject: (b.subject || '').trim(),
    batch,
    kind: 'other',
    sourceType: 'link',
    fileUrl: url,
  });
  return ok(res, serialize(doc), 'Link added.');
}

async function list(req, res) {
  const StudyMaterial = mongoose.model('StudyMaterial');
  const q = { removed: false };
  if (!isManager(req.admin)) q.teacherCrmUser = req.admin._id;
  const rows = await StudyMaterial.find(q).sort({ uploadedAt: -1 }).limit(500).lean();
  return ok(res, rows.map(serialize));
}

async function remove(req, res) {
  const StudyMaterial = mongoose.model('StudyMaterial');
  const m = await StudyMaterial.findOne({ _id: req.params.id, removed: false });
  if (!m) return bad(res, 404, 'Not found.');
  if (!isManager(req.admin) && String(m.teacherCrmUser) !== String(req.admin._id)) return bad(res, 403, 'Not yours.');
  m.removed = true;
  m.updated = new Date();
  await m.save();
  return ok(res, {}, 'Removed.');
}

async function mine(req, res) {
  const StudyMaterial = mongoose.model('StudyMaterial');
  const Student = mongoose.model('Student');
  const rows0 = await Student.find({ removed: false, email: rxEq(req.admin.email || '') }).select('batch').lean();
  const batches = [...new Set(rows0.map((r) => r.batch).filter(Boolean))];
  if (!batches.length) return ok(res, []);
  const rows = await StudyMaterial.find({ removed: false, batch: { $in: batches } }).sort({ uploadedAt: -1 }).limit(500).lean();
  return ok(res, rows.map(serialize));
}

module.exports = { upload, addLink, list, remove, mine };
