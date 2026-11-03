const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES, LMS_STUDENT_ROLES } = require('../../../../config/roles');
const realtime = require('../../../../services/lms/realtime');
const auditLog = require('../../../../services/lms/auditLog');

// External (non-Career Lab) certificates — design L8.
//   learner:  GET  /api/lms/my/external-certificates
//             POST /api/lms/my/external-certificates           { provider, title, credentialId?, verifyUrl?, issuedOn?, file? }
//             POST /api/lms/my/external-certificates/file      (multipart "file": pdf / png / jpg, 10 MB)
//             DELETE /api/lms/my/external-certificates/:id     (own, while unverified)
//   Support / management:
//             GET  /api/lms/admin/external-certificates?status=
//             POST /api/lms/admin/external-certificates/:id/review { decision: verified|rejected, note? }

const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const isStaff = (a) => !!(a && LMS_FULL_ACCESS_ROLES.includes(a.role));
const isStudent = (a) => !!(a && LMS_STUDENT_ROLES.includes(a.role));
const httpUrl = (s) => {
  const v = String(s || '').trim().slice(0, 500);
  return /^https?:\/\//i.test(v) ? v : '';
};
const shape = (c) => ({
  id: String(c._id),
  provider: c.provider,
  title: c.title,
  credentialId: c.credentialId || '',
  verifyUrl: c.verifyUrl || '',
  issuedOn: c.issuedOn || null,
  file: c.file && c.file.url ? c.file : null,
  status: c.status,
  reviewedByName: c.reviewedByName || '',
  reviewedAt: c.reviewedAt || null,
  reviewNote: c.reviewNote || '',
  created: c.created,
  studentName: c.studentName,
  studentEmail: c.studentEmail,
});

async function mine(req, res) {
  const rows = await mongoose.model('ExternalCertificate').find({ student: req.admin._id, removed: false }).sort({ created: -1 }).lean();
  return ok(res, rows.map(shape));
}

async function uploadFile(req, res) {
  if (!req.file) return bad(res, 400, 'Choose a PDF or image (max 10 MB).');
  return ok(res, { name: req.file.originalname, url: `public/uploads/external-certificates/${require('path').basename(req.file.path)}` });
}

async function add(req, res) {
  if (!isStudent(req.admin)) return bad(res, 403, 'Candidates only.');
  const b = req.body || {};
  const provider = String(b.provider || '').trim().slice(0, 80);
  const title = String(b.title || '').trim().slice(0, 200);
  if (!provider || !title) return bad(res, 400, 'Provider and certificate name are required.');
  const verifyUrl = httpUrl(b.verifyUrl);
  const file = b.file && typeof b.file.url === 'string' && b.file.url.startsWith(`public/uploads/external-certificates/${req.admin._id}-`) ? { name: String(b.file.name || 'certificate').slice(0, 200), url: b.file.url } : undefined;
  if (!verifyUrl && !file) return bad(res, 400, 'Add the provider verification link or upload the certificate.');
  const count = await mongoose.model('ExternalCertificate').countDocuments({ student: req.admin._id, removed: false });
  if (count >= 20) return bad(res, 400, 'You can add up to 20 external certificates.');
  const c = await new (mongoose.model('ExternalCertificate'))({
    student: req.admin._id,
    studentName: [req.admin.name, req.admin.surname].filter(Boolean).join(' '),
    studentEmail: req.admin.email,
    provider,
    title,
    credentialId: String(b.credentialId || '').trim().slice(0, 120) || undefined,
    verifyUrl: verifyUrl || undefined,
    issuedOn: b.issuedOn && !Number.isNaN(new Date(b.issuedOn).getTime()) ? new Date(b.issuedOn) : undefined,
    file,
  }).save();
  const { notify } = require('../../../../notify');
  notify({
    audience: 'support',
    actorId: req.admin._id,
    actorName: c.studentName,
    module: 'Support',
    type: 'lms.external_certificate',
    title: `External certificate to verify · ${c.provider}`,
    body: `${c.studentName}: ${c.title}`,
    link: '/lms',
  });
  await auditLog.record({ module: 'certificate', action: 'external_add', entityType: 'ExternalCertificate', entityId: c._id, admin: req.admin, after: { provider, title } });
  return ok(res, shape(c), 'Added — Support will verify it with the provider.');
}

async function remove(req, res) {
  const c = await mongoose.model('ExternalCertificate').findOne({ _id: req.params.id, removed: false });
  if (!c || String(c.student) !== String(req.admin._id)) return bad(res, 404, 'Not found.');
  if (c.status === 'verified') return bad(res, 400, 'A verified certificate can only be removed by Support.');
  c.removed = true;
  c.updated = new Date();
  await c.save();
  return ok(res, { id: String(c._id) }, 'Removed.');
}

async function list(req, res) {
  if (!isStaff(req.admin)) return bad(res, 403, 'Not allowed.');
  const q = { removed: false };
  if (['unverified', 'verified', 'rejected'].includes(req.query.status)) q.status = req.query.status;
  const rows = await mongoose.model('ExternalCertificate').find(q).sort({ status: 1, created: -1 }).limit(500).lean();
  return ok(res, rows.map(shape));
}

async function review(req, res) {
  if (!isStaff(req.admin)) return bad(res, 403, 'Not allowed.');
  const b = req.body || {};
  if (!['verified', 'rejected'].includes(b.decision)) return bad(res, 400, 'Choose verified or rejected.');
  const c = await mongoose.model('ExternalCertificate').findOne({ _id: req.params.id, removed: false });
  if (!c) return bad(res, 404, 'Not found.');
  c.status = b.decision;
  c.reviewedBy = req.admin._id;
  c.reviewedByName = [req.admin.name, req.admin.surname].filter(Boolean).join(' ');
  c.reviewedAt = new Date();
  c.reviewNote = String(b.note || '').trim().slice(0, 500) || undefined;
  c.updated = new Date();
  await c.save();
  await realtime.notify([c.student], {
    type: 'lms.external_certificate.reviewed',
    title: b.decision === 'verified' ? `✅ ${c.provider} certificate verified` : `❌ ${c.provider} certificate could not be verified`,
    body: c.reviewNote || c.title,
    link: '/learn/certificates',
    actorName: req.admin.name,
  });
  await auditLog.record({ module: 'certificate', action: `external_${b.decision}`, entityType: 'ExternalCertificate', entityId: c._id, admin: req.admin, after: { decision: b.decision } });
  return ok(res, shape(c), b.decision === 'verified' ? 'Marked verified.' : 'Marked rejected.');
}

module.exports = { mine, uploadFile, add, remove, list, review };
