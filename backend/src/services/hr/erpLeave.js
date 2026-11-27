const mongoose = require('mongoose');
const E = require('./erpAttendance');

// Leave for the Attendance ERP (/employee › Apply Leave, admin Leaves). Uses
// the same LeaveRequest collection as the header leave widget, so a request
// shows in both places and approval goes through the same decideLeave()
// (which also pauses a Sales user's dialer on the day).
//
// Emails (Messenger › Email, templates hr-erp-leave-*):
//   new request → LEAVE_ADMIN_EMAIL + LEAVE_NOTIFICATION_EMAIL (backend .env;
//                 falls back to LEAVE_APPROVER_EMAIL) — never from the browser
//   approved / rejected → the employee

const Leave = () => mongoose.model('LeaveRequest');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
const PUBLIC_BASE = () => (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://clcone.careerlabconsulting.com').replace(/\/+$/, '');

function recipients() {
  const list = [process.env.LEAVE_ADMIN_EMAIL, process.env.LEAVE_NOTIFICATION_EMAIL]
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length && process.env.LEAVE_APPROVER_EMAIL) list.push(process.env.LEAVE_APPROVER_EMAIL);
  return [...new Set(list)];
}

const row = (k, v, color) =>
  `<tr><td style="padding:9px 12px;background:#f8fafc;color:#64748b;width:120px;font-size:13px;border-bottom:1px solid #f1f5f9">${k}</td><td style="padding:9px 12px;color:${color || '#0f172a'};font-weight:600;font-size:13px;border-bottom:1px solid #f1f5f9">${v}</td></tr>`;
const shell = (color, title, body, footerKey) => `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
  <div style="background:${color};color:#fff;padding:18px 22px;font-weight:700;font-size:16px">${title}</div>
  <div style="padding:22px;color:#334155;font-size:14px;line-height:22px">${body}</div>
  <div style="padding:14px 22px;background:#f8fafc;font-size:11px;color:#64748b">Career Lab Consulting · CLC One · template ${footerKey}</div></div>`;
const table = (rows) => `<table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:14px 0">${rows}</table>`;
const cta = (href, label) => `<a href="${href}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#4f46e5;color:#fff;font-weight:600;text-decoration:none">${label}</a>`;

function requestEmail(v) {
  return {
    subject: `New leave request · ${v.employee} · ${v.from}`,
    html: shell(
      '#4f46e5',
      'New Leave Request',
      `A new leave request needs your review.${table(
        row('Employee', esc(v.employee)) + row('Leave type', esc(v.leaveType)) + row('From', esc(v.from)) + row('To', esc(v.to)) + row('Duration', esc(v.duration)) + row('Reason', esc(v.reason)) + row('Status', 'Pending Approval', '#b45309')
      )}Please login to the Admin ERP to review this request.<br><br>${cta(v.link, 'Review in Admin ERP')}`,
      'hr-erp-leave-request'
    ),
  };
}
function decisionEmail(v, approved) {
  return approved
    ? {
        subject: `Your leave is approved · ${v.from}`,
        html: shell(
          '#16a34a',
          'Leave approved',
          `Hi ${esc(v.first)}, your leave request has been approved.${table(
            row('Leave', esc(v.leaveType)) + row('Date', esc(v.dates)) + row('Status', 'Approved', '#15803d') + row('Approved by', esc(v.by)) + row('Balance left', esc(v.balance))
          )}${cta(v.link, 'Open my leaves')}`,
          'hr-erp-leave-approved'
        ),
      }
    : {
        subject: `Your leave request was not approved · ${v.from}`,
        html: shell(
          '#dc2626',
          'Leave rejected',
          `Hi ${esc(v.first)}, your leave request has been rejected.${table(row('Leave', esc(v.leaveType)) + row('Date', esc(v.dates)) + row('Status', 'Rejected', '#b91c1c'))}<div style="padding:12px 14px;border-radius:10px;background:#fef2f2;color:#991b1b;font-size:13px;margin-bottom:14px"><b>Reason:</b> ${esc(v.reason || '—')}</div>${cta(v.link, 'Apply for another date')}`,
          'hr-erp-leave-rejected'
        ),
      };
}

async function send(to, m, templateKey, vars) {
  const { mailReady, sendMailWithRetry } = require('../mail/transport');
  if (!mailReady() || !to || (Array.isArray(to) && !to.length)) return { skipped: true };
  return sendMailWithRetry({ from: `"CLC One" <${process.env.GMAIL_USER}>`, to: Array.isArray(to) ? to.join(',') : to, subject: m.subject, html: m.html, templateKey, vars });
}

const leaveLabel = (l) => {
  const f = fmtDate(l.fromDate);
  const t = fmtDate(l.toDate);
  if (l.durationType === 'half') return `${f} · ${l.halfPart === 'second' ? 'second' : 'first'} half`;
  return f === t ? f : `${f} – ${t}`;
};

// Working days between two day keys (weekly offs + holidays not counted).
async function countDays(fromKey, toKey, dayType) {
  const S = await E.getSettings();
  if (fromKey === toKey && dayType && dayType !== 'full') return 0.5;
  return (await E.workingDays(fromKey, toKey, S)).length;
}

async function apply(admin, b, file) {
  const S = await E.getSettings();
  const type = E.LEAVE_TYPES.includes(b.leaveType) ? b.leaveType : null;
  if (!type) return { ok: false, error: 'Pick a leave type.' };
  const from = String(b.fromDate || '').slice(0, 10);
  const to = String(b.toDate || b.fromDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, error: 'Pick the dates.' };
  if (to < from) return { ok: false, error: '"To" date is before "From" date.' };
  if (to < E.todayKey()) return { ok: false, error: 'Those dates have already passed.' };
  const reason = String(b.reason || '').trim();
  if (!reason) return { ok: false, error: 'Please write a reason.' };
  const dayType = from === to && ['first', 'second'].includes(b.dayType) ? b.dayType : 'full';
  const days = await countDays(from, to, dayType);
  if (!days) return { ok: false, error: 'Those dates are only weekly offs / holidays.' };
  let fromDate = E.dayStart(from);
  let toDate = E.dayEnd(to);
  if (dayType === 'first') toDate = E.istAt(from, S.lunchWindowStart);
  if (dayType === 'second') fromDate = E.istAt(from, S.lunchWindowStart);
  const overlap = await Leave().findOne({ removed: false, adminId: String(admin._id), status: { $in: ['Pending', 'Approved'] }, fromDate: { $lt: toDate }, toDate: { $gt: fromDate } }).lean();
  if (overlap) return { ok: false, error: `You already have a ${overlap.status.toLowerCase()} leave on those dates (${leaveLabel(overlap)}).` };
  const bal = (await E.leaveBalance(admin._id, Number(from.slice(0, 4)), S, await mongoose.model('ErpProfile').findOne({ admin: admin._id }).lean())).find((x) => x.type === type);
  if (type !== 'Other' && bal && bal.total > 0 && days > bal.left) return { ok: false, error: `Only ${bal.left} ${type} day(s) left this year.` };

  let attachmentId;
  let attachmentName;
  if (file && file.buffer) {
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: 'The attachment is larger than 5 MB.' };
    if (!/^(application\/pdf|image\/(png|jpe?g))$/.test(file.mimetype)) return { ok: false, error: 'Attach a PDF, JPG or PNG.' };
    const f = await mongoose.model('ErpFile').create({ admin: admin._id, name: String(file.originalname || 'attachment').slice(0, 120), mime: file.mimetype, size: file.size, data: file.buffer });
    attachmentId = String(f._id);
    attachmentName = f.name;
  }
  const profile = await mongoose.model('ErpProfile').findOne({ admin: admin._id }).lean();
  const DEPTS = ['Sales', 'Marketing', 'Operations', 'Engineering', 'HR', 'Finance', 'Support', 'Training', 'Admin'];
  const leave = await Leave().create({
    employee: E.fullName(admin),
    department: profile && DEPTS.includes(profile.department) ? profile.department : undefined,
    leaveType: type,
    fromDate,
    toDate,
    days,
    halfDay: dayType !== 'full',
    halfPart: dayType === 'second' ? 'second' : dayType === 'first' ? 'first' : undefined,
    durationType: dayType !== 'full' ? 'half' : from === to ? 'full' : 'multi',
    reason: reason.slice(0, 500),
    status: 'Pending',
    appliedOn: new Date(),
    adminId: String(admin._id),
    emergency: type === 'Emergency',
    lateNotice: fromDate.getTime() - Date.now() < 24 * 3600e3,
    approver: recipients().join(', '),
    attachmentId,
    attachmentName,
    source: 'erp-portal',
  });
  const vars = { employee: E.fullName(admin), leaveType: `${type} Leave`, from: fmtDate(fromDate), to: fmtDate(toDate), duration: `${days} day${days === 1 ? '' : 's'}`, reason, link: `${PUBLIC_BASE()}/hr/work-tracker` };
  send(recipients(), requestEmail(vars), 'hr-erp-leave-request', vars).catch((e) => console.error('[erp-leave] email failed:', e.message));
  require('../../notify').notify({
    audience: 'management',
    actorId: admin._id,
    actorName: E.fullName(admin),
    module: 'HRMS',
    type: 'leave.applied',
    title: 'New leave request',
    body: `${E.fullName(admin)} · ${type} Leave · ${leaveLabel(leave)}`,
    link: '/hr/work-tracker',
  });
  return { ok: true, leave };
}

async function decide(req, leaveId, action, reason, { email = true } = {}) {
  const wd = require('./workday');
  const before = await Leave().findOne({ _id: leaveId, removed: false }).lean();
  if (!before) return { ok: false, error: 'Leave request not found.' };
  if (action === 'reject' && !String(reason || '').trim()) return { ok: false, error: 'Write the reason for rejection.' };
  const r = await wd.decideLeave(leaveId, action, { name: E.fullName(req.admin), id: req.admin._id }, reason);
  if (!r.ok) return r;
  const l = r.leave;
  const emp = l.adminId && mongoose.isValidObjectId(l.adminId) ? await mongoose.model('Admin').findById(l.adminId).select('name surname email').lean() : null;
  await E.audit(req, {
    action: action === 'approve' ? 'Approved leave' : 'Rejected leave',
    employee: emp ? emp._id : undefined,
    employeeName: l.employee,
    oldValue: 'Pending',
    newValue: l.status,
    reason: reason || '',
  });
  const S = await E.getSettings();
  if (email && S.emailEmployee && emp && emp.email) {
    const bal = (await E.leaveBalance(emp._id, new Date(l.fromDate).getUTCFullYear(), S, await mongoose.model('ErpProfile').findOne({ admin: emp._id }).lean())).find((x) => x.type === l.leaveType);
    const vars = { first: emp.name, leaveType: `${l.leaveType} Leave`, dates: leaveLabel(l), from: fmtDate(l.fromDate), by: `${E.fullName(req.admin)} · ${fmtDate(new Date())}`, balance: bal ? `${bal.left} ${l.leaveType} left` : '—', reason: reason || '', link: `${PUBLIC_BASE()}/employee/${action === 'approve' ? 'leaves' : 'apply-leave'}` };
    const approved = action === 'approve';
    send(emp.email, decisionEmail(vars, approved), approved ? 'hr-erp-leave-approved' : 'hr-erp-leave-rejected', vars).catch((e) => console.error('[erp-leave] decision email failed:', e.message));
  }
  return { ok: true, leave: l };
}

module.exports = { apply, decide, leaveLabel, countDays, requestEmail, decisionEmail, recipients, fmtDate };
