const mongoose = require('mongoose');
const mailer = require('../services/lms/mailer');
const { CRM_ADMIN_ROLES } = require('../config/roles');

// Spec §12 "Attendance/admin reporting dependent on manual sheets" — a
// real-time dashboard + CSV/XLSX export already exist (liveScope.js's
// attendanceDashboard/attendanceExport), but nothing produced a scheduled
// summary — the one piece of that requirement genuinely missing. Runs once
// per calendar day (IST, via process.env.TZ set in server.js/api/index.js),
// emails management yesterday's attendance (per class, with the absent
// names), the candidates currently deactivated, and a few operational health
// numbers. Same in-process-tick shape as every other job in this directory —
// no cron infra in this app — plus a manual re-run via the /api/cron/tick
// safety net for the serverless deployment.

const TICK_MS = Number(process.env.LMS_DAILY_SUMMARY_TICK_MS || 60 * 60 * 1000); // check hourly
const SEND_HOUR = Number(process.env.LMS_DAILY_SUMMARY_HOUR || 8); // 8am IST
const HELD = ['ended', 'recording_processing', 'recording_available'];

function dayBounds(daysAgo = 1) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (daysAgo - 1));
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  return { start, end };
}

const crmBase = () => {
  try {
    return String(require('../services/lms').lmsConfig.meeting.crmBaseUrl || '').replace(/\/+$/, '') || 'https://clcone.careerlabconsulting.com';
  } catch (e) {
    return 'https://clcone.careerlabconsulting.com';
  }
};

async function buildSummary() {
  const { start, end } = dayBounds(1);
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const Student = mongoose.model('Student');
  const sessions = await LmsLiveSession.find({
    removed: false,
    scheduledStart: { $gte: start, $lt: end },
    status: { $in: [...HELD, 'cancelled'] },
  })
    .select('title batchName teacherName scheduledStart actualStart actualEnd participants status')
    .sort({ scheduledStart: 1 })
    .lean();

  const roster = await Student.find({ removed: false })
    .select('name email batch status accessDisabled accessDisabledAt accessDisabledReason accessDisabledBy')
    .lean();
  const byEmail = new Map(roster.map((r) => [String(r.email || '').toLowerCase(), r]));
  const isOnHold = (email) => {
    const r = byEmail.get(String(email || '').toLowerCase());
    return !!(r && (r.accessDisabled || r.status === 'Dropped'));
  };

  const totals = { present: 0, late: 0, partial: 0, absent: 0, excused: 0, pctSum: 0, pctCount: 0 };
  const classes = [];
  for (const s of sessions) {
    if (s.status === 'cancelled') {
      classes.push({ batch: s.batchName, title: s.title, teacher: s.teacherName, cancelled: true });
      continue;
    }
    const c = { batch: s.batchName, title: s.title, teacher: s.teacherName, present: 0, late: 0, partial: 0, absent: 0, excused: 0, pctSum: 0, n: 0, absentNames: [], joined: 0 };
    const seen = new Set();
    for (const p of s.participants || []) {
      if (p.role !== 'student') continue;
      const email = String(p.email || '').toLowerCase();
      seen.add(email);
      // deactivated / dropped candidates can't attend — listed in their own section, not as absent
      if (isOnHold(email)) continue;
      if (p.joinCount > 0) c.joined += 1;
      if (p.attendanceStatus === 'EXCUSED') { c.excused += 1; continue; }
      if (p.attendanceStatus === 'PRESENT') c.present += 1;
      else if (p.attendanceStatus === 'LATE') { c.present += 1; c.late += 1; }
      else if (p.attendanceStatus === 'PARTIAL') c.partial += 1;
      else { c.absent += 1; c.absentNames.push(p.name || p.email); }
      c.pctSum += p.attendancePct || 0;
      c.n += 1;
    }
    // active candidates of this batch who never got onto the class list at all
    for (const r of roster) {
      if (r.batch !== s.batchName || r.accessDisabled || r.status === 'Dropped') continue;
      if (seen.has(String(r.email || '').toLowerCase())) continue;
      c.absent += 1;
      c.absentNames.push(r.name || r.email);
      c.n += 1;
    }
    c.avgPct = c.n ? Math.round(c.pctSum / c.n) : null;
    ['present', 'late', 'partial', 'absent', 'excused'].forEach((k) => (totals[k] += c[k]));
    totals.pctSum += c.pctSum;
    totals.pctCount += c.n;
    classes.push(c);
  }

  const deactivated = roster
    .filter((r) => r.accessDisabled)
    .sort((a, b) => new Date(b.accessDisabledAt || 0) - new Date(a.accessDisabledAt || 0))
    .map((r) => ({
      name: r.name,
      email: r.email,
      batch: r.batch,
      since: r.accessDisabledAt,
      by: r.accessDisabledBy,
      reason: r.accessDisabledReason,
      isNew: r.accessDisabledAt && new Date(r.accessDisabledAt) >= start && new Date(r.accessDisabledAt) < end,
    }));
  const dropped = roster.filter((r) => r.status === 'Dropped' && !r.accessDisabled).length;

  const LmsSyncJob = mongoose.model('LmsSyncJob');
  const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
  const PaymentRequest = mongoose.model('PaymentRequest');
  const { overdueQuery } = require('../services/payments/financeHold');

  const [failedSyncJobs, pendingAcks, overdueEmis] = await Promise.all([
    LmsSyncJob.countDocuments({ status: { $in: ['failed', 'dead'] } }).catch(() => 0),
    PolicyAcknowledgement.countDocuments({ removed: { $ne: true }, status: 'pending' }).catch(() => 0),
    PaymentRequest.countDocuments(overdueQuery()).catch(() => 0),
  ]);

  return {
    date: start,
    classesHeld: classes.filter((c) => !c.cancelled).length,
    classesCancelled: classes.filter((c) => c.cancelled).length,
    ...totals,
    avgAttendancePct: totals.pctCount ? Math.round(totals.pctSum / totals.pctCount) : null,
    classes,
    deactivated,
    dropped,
    activeCandidates: roster.filter((r) => !r.accessDisabled && r.status !== 'Dropped').length,
    failedSyncJobs,
    pendingAcks,
    overdueEmis,
  };
}

/* ── email (table layout + inline styles: what Gmail/Outlook render reliably) ── */

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const pctColor = (p) => (p == null ? '#64748b' : p >= 75 ? '#0f7a4b' : p >= 50 ? '#b45309' : '#c0362c');
const pctBg = (p) => (p == null ? '#f1f5f9' : p >= 75 ? '#e6f7ee' : p >= 50 ? '#fff4dc' : '#fdecec');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');

function tile(label, value, sub, color) {
  return `<td width="25%" style="padding:6px" valign="top">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e9f0;border-radius:12px">
      <tr><td style="padding:14px 14px 12px;font-family:${FONT}">
        <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#64748b;font-weight:600">${label}</div>
        <div style="font-size:26px;line-height:32px;font-weight:700;color:${color || '#0f172a'};margin-top:4px">${value}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px">${sub || '&nbsp;'}</div>
      </td></tr>
    </table>
  </td>`;
}

function section(title, inner, note) {
  return `<tr><td style="padding:22px 24px 0;font-family:${FONT}">
    <div style="font-size:15px;font-weight:700;color:#0f172a">${title}</div>
    ${note ? `<div style="font-size:12.5px;color:#64748b;margin-top:2px">${note}</div>` : ''}
    <div style="margin-top:10px">${inner}</div>
  </td></tr>`;
}

function summaryHtml(s) {
  const dateStr = s.date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const th = (t, align = 'left') => `<th align="${align}" style="padding:9px 10px;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:#64748b;font-weight:600;background:#f8fafc;border-bottom:1px solid #e5e9f0">${t}</th>`;
  const td = (v, align = 'left', extra = '') => `<td align="${align}" style="padding:10px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;${extra}" valign="top">${v}</td>`;

  const classRows = s.classes.length
    ? s.classes
        .map((c) => {
          if (c.cancelled) {
            return `<tr>${td(`<b>${esc(c.batch)}</b><div style="color:#64748b;font-size:12px">${esc(c.title)}</div>`)}${td(esc(c.teacher || '—'))}${td('<span style="color:#64748b">Cancelled</span>', 'center', '')}${td('')}${td('')}</tr>`;
          }
          const warnText = !c.n ? 'No active candidates in this batch' : !c.joined ? 'No candidate joined' : '';
          const warn = warnText ? `<div style="margin-top:3px;font-size:11.5px;color:#b45309">⚠ ${warnText}</div>` : '';
          return `<tr>
            ${td(`<b>${esc(c.batch)}</b><div style="color:#64748b;font-size:12px">${esc(c.title)}</div>${warn}`)}
            ${td(esc(c.teacher || '—'))}
            ${td(`<b style="color:#0f7a4b">${c.present}</b>${c.late ? `<div style="font-size:11px;color:#94a3b8">${c.late} late</div>` : ''}`, 'center')}
            ${td(`<b style="color:${c.absent ? '#c0362c' : '#0f172a'}">${c.absent}</b>${c.partial ? `<div style="font-size:11px;color:#94a3b8">${c.partial} partial</div>` : ''}`, 'center')}
            ${td(`<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-weight:700;font-size:12px;color:${pctColor(c.avgPct)};background:${pctBg(c.avgPct)}">${c.avgPct == null ? '—' : `${c.avgPct}%`}</span>`, 'right')}
          </tr>`;
        })
        .join('')
    : `<tr>${td('<span style="color:#64748b">No classes were scheduled.</span>', 'left', 'border-bottom:0')}</tr>`;

  const classTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;border-collapse:separate;overflow:hidden">
    <tr>${th('Batch / class')}${th('Teacher')}${th('Present', 'center')}${th('Absent', 'center')}${th('Attendance', 'right')}</tr>
    ${classRows}
  </table>`;

  const absentBlocks = s.classes
    .filter((c) => !c.cancelled && c.absentNames && c.absentNames.length)
    .map(
      (c) => `<div style="padding:10px 12px;border:1px solid #f3d4d1;background:#fffafa;border-radius:10px;margin-bottom:8px">
        <div style="font-size:12.5px;font-weight:700;color:#0f172a">${esc(c.batch)} <span style="font-weight:600;color:#c0362c">· ${c.absentNames.length} absent</span></div>
        <div style="font-size:12.5px;color:#475569;margin-top:3px;line-height:19px">${c.absentNames.map(esc).join(', ')}</div>
      </div>`
    )
    .join('');

  const deactRows = s.deactivated.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;border-collapse:separate;overflow:hidden">
        <tr>${th('Candidate')}${th('Batch')}${th('Since')}${th('Reason')}</tr>
        ${s.deactivated
          .map(
            (d) => `<tr>
              ${td(`<b>${esc(d.name)}</b>${d.isNew ? ' <span style="display:inline-block;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:700;color:#c0362c;background:#fdecec">NEW</span>' : ''}<div style="color:#64748b;font-size:12px">${esc(d.email)}</div>`)}
              ${td(esc(d.batch || '—'))}
              ${td(esc(fmtDay(d.since)))}
              ${td(`<span style="color:#475569">${esc(d.reason || '—')}</span>${d.by ? `<div style="font-size:11px;color:#94a3b8">by ${esc(d.by)}</div>` : ''}`)}
            </tr>`
          )
          .join('')}
      </table>`
    : '<div style="font-size:13px;color:#64748b;padding:10px 12px;border:1px dashed #e5e9f0;border-radius:10px">No candidate is deactivated.</div>';

  const opsRow = (label, val) => `<tr>
    <td style="padding:9px 12px;font-size:13px;color:#475569;border-bottom:1px solid #f1f5f9">${label}</td>
    <td align="right" style="padding:9px 12px;font-size:13px;font-weight:700;color:${val ? '#b45309' : '#0f172a'};border-bottom:1px solid #f1f5f9">${val}</td>
  </tr>`;

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e9f0">
    <tr><td style="background:#0f172a;padding:22px 24px;font-family:${FONT}">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc;font-weight:600">Career Lab Consulting · LMS</div>
      <div style="font-size:21px;font-weight:700;color:#ffffff;margin-top:4px">Daily summary</div>
      <div style="font-size:13.5px;color:#cbd5e1;margin-top:2px">${esc(dateStr)}</div>
    </td></tr>

    <tr><td style="padding:16px 18px 0;background:#f8fafc">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${tile('Classes held', s.classesHeld, s.classesCancelled ? `${s.classesCancelled} cancelled` : 'none cancelled')}
        ${tile('Present', s.present, s.late ? `${s.late} late` : '&nbsp;', '#0f7a4b')}
        ${tile('Absent', s.absent, s.partial ? `${s.partial} partial` : s.excused ? `${s.excused} excused` : '&nbsp;', s.absent ? '#c0362c' : '#0f172a')}
        ${tile('Attendance', s.avgAttendancePct == null ? '—' : `${s.avgAttendancePct}%`, 'average', pctColor(s.avgAttendancePct))}
      </tr></table>
    </td></tr>
    <tr><td style="background:#f8fafc;height:16px;line-height:16px">&nbsp;</td></tr>

    ${section('Classes', classTable)}
    ${absentBlocks ? section('Absent candidates', absentBlocks) : ''}
    ${section(
      `Deactivated candidates <span style="font-weight:600;color:#64748b">· ${s.deactivated.length}</span>`,
      deactRows,
      `LMS access blocked — not counted as absent.${s.dropped ? ` ${s.dropped} more marked Dropped.` : ''} ${s.activeCandidates} active candidates.`
    )}
    ${section(
      'Operations',
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;border-collapse:separate;overflow:hidden">
        ${opsRow('Pending policy acknowledgements', s.pendingAcks)}
        ${opsRow('EMI installments overdue', s.overdueEmis)}
        ${opsRow('Failed Moodle sync jobs', s.failedSyncJobs)}
      </table>`
    )}

    <tr><td align="center" style="padding:24px 24px 26px;font-family:${FONT}">
      <a href="${esc(crmBase())}/lms/attendance" style="display:inline-block;background:#0e7490;color:#ffffff;text-decoration:none;font-size:13.5px;font-weight:600;padding:11px 22px;border-radius:10px">Open Attendance dashboard</a>
      <div style="font-size:11.5px;color:#94a3b8;margin-top:12px">Automated email, sent every morning at ${SEND_HOUR}:00 to CRM admins. Attendance % counts 90%+ of a class's actual length as full.</div>
    </td></tr>
  </table>
  </td></tr></table></body></html>`;
}

async function sendSummary() {
  if (!mailer.ready()) return;
  const Admin = mongoose.model('Admin');
  // LMS/attendance/finance ops summary — true CRM admins only, not Sales
  // Manager (she has no LMS access, see CRM_ADMIN_ROLES's comment).
  const recipients = await Admin.find({ removed: false, enabled: true, role: { $in: CRM_ADMIN_ROLES } }).select('email').lean();
  const emails = recipients.map((r) => r.email).filter(Boolean);
  if (!emails.length) return;

  const summary = await buildSummary();
  const pct = summary.avgAttendancePct == null ? '' : ` · ${summary.avgAttendancePct}% attendance`;
  await mailer.sendMail(emails, {
    subject: `LMS daily summary — ${summary.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${summary.classesHeld} classes${pct}`,
    html: summaryHtml(summary),
  });
}

// One send per day even across restarts/multiple processes: the day is
// claimed in the DB before sending (an in-memory flag alone re-sent the
// email whenever the server restarted during the send hour).
async function claimToday(dayKey) {
  const Setting = mongoose.model('Setting');
  const key = { settingCategory: 'lms_jobs', settingKey: 'daily_summary_last_sent' };
  await Setting.updateOne(key, { $setOnInsert: { ...key, settingValue: '', isPrivate: true, valueType: 'String' } }, { upsert: true });
  const claimed = await Setting.findOneAndUpdate({ ...key, settingValue: { $ne: dayKey } }, { $set: { settingValue: dayKey } });
  return !!claimed;
}

async function runOnce() {
  try {
    require('../services/lms/health').ping('lmsDailySummaryTick');
    const now = new Date();
    if (now.getHours() !== SEND_HOUR) return;
    const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (!(await claimToday(dayKey))) return;
    await sendSummary();
  } catch (e) {
    console.error('[lms] daily summary tick failed:', e.message);
  }
}

function start() {
  setInterval(runOnce, TICK_MS);
  console.log(`[lms] daily summary tick — sends once/day around ${SEND_HOUR}:00`);
}

start.runOnce = runOnce;
start.buildSummary = buildSummary;
start.summaryHtml = summaryHtml;
module.exports = start;
