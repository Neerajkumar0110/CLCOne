// Emails whose HTML used to be written inline at the place that sends them.
// Moved here unchanged, as plain builders → { subject, html }, so the sending
// code and Messenger › Email (which shows every email exactly as it goes
// out) use the very same function.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const card = (inner) => `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">${inner}</div>`;

const assessmentResult = ({ name, testType, score, total, pct, status }) => ({
  subject: `${testType} result: ${status}`,
  html: `<p>Hi ${name || ''},</p><p>Your <b>${testType}</b> assessment has been evaluated.</p><p>Score: <b>${score}/${total}</b> (${pct}%)<br>Status: <b>${status}</b></p><p>Sign in to the portal to see the full topic-wise breakdown.</p>`,
});

// a proctored test ended by proctoring (assessments/proctorController.js)
const assessmentSuspended = ({ name, testType, reason, when }) => ({
  subject: `Your ${testType} test was ended — proctoring violation`,
  html: card(`<p>Hi ${esc(name)},</p>
    <p>Your <b>${esc(testType)}</b> test was <b>ended automatically</b> on ${esc(when)} because our proctoring system detected a breach of the test rules:</p>
    <p style="padding:10px 14px;border-left:4px solid #dc2626;background:#fef2f2;border-radius:6px"><b>${esc(reason)}</b></p>
    <p>This is treated as <b>unfair means (cheating)</b>, and this attempt counts as used. Tests must be taken alone, without a phone, with the camera and screen sharing on and without leaving the test tab.</p>
    <p>If you believe this is a mistake, reply to this email or contact your project manager within 48 hours — the recorded evidence will be reviewed.</p>
    <p style="color:#667085;font-size:13px">— Career Lab Consulting</p>`),
});

// staff announcement (LMS › Announcements) and an Ops-approved mass message
const announcement = ({ title, message, from, course }) => ({
  subject: `📢 ${title}`,
  html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>${esc(title)}</h2>
          <p style="white-space:pre-wrap">${esc(message || '')}</p>
          <p style="color:#667085;font-size:13px">— ${esc(from)}${course ? ' · ' + esc(course) : ''}</p>
        </div>`,
});

const policyPublished = ({ policyTitle, version, mandatory }) => ({
  subject: `Action required: acknowledge "${policyTitle}"`,
  html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>${esc(policyTitle)}</h2>
          <p>Please sign in to the portal and acknowledge this ${mandatory ? '<b>mandatory</b> ' : ''}policy (version ${version}).</p>
        </div>`,
});

const policyReminder = ({ policyTitle, version }) => ({
  subject: `Reminder: acknowledge "${policyTitle}"`,
  html: `<p>You still have a pending acknowledgement for <b>${esc(policyTitle)}</b> (v${esc(version)}). Please sign in to the portal to complete it.</p>`,
});

const projectReview = ({ projectTitle, decision, feedback, score }) => ({
  subject: `Project result — ${projectTitle}: ${decision}`,
  html: card(
    `<h2 style="margin:0 0 8px;font-size:19px">${esc(projectTitle)}</h2><p style="margin:0 0 12px">Result: <b style="color:${/^Qualified/.test(decision) ? '#166534' : /^Not/.test(decision) ? '#b91c1c' : '#9a3412'}">${esc(decision)}</b>${score != null && score !== '' ? ` · score ${esc(score)}` : ''}</p>${feedback ? `<div style="padding:12px 14px;background:#f8fafc;border-left:3px solid #0e7490;border-radius:6px"><b>${/^Not/.test(decision) ? 'Reason' : 'Feedback'}:</b><br>${esc(feedback)}</div>` : ''}<p style="color:#889;font-size:12px;margin:18px 0 0">Open My Project in the LMS for the full review.</p>`
  ),
});

// body = the queue's level text (plain text with new lines)
const attendanceEscalation = ({ subject, body }) => ({
  subject,
  html: `<p>${String(body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p><p>— Career Lab Support</p>`,
});

const certificateIssued = ({ name, certificateTitle, course, certificateId, score, grade, verifyLink }) => ({
  subject: `🎓 Certificate issued — ${course}`,
  html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>Congratulations, ${esc(name)}!</h2>
          <p>You've earned a <b>${esc(certificateTitle)}</b> for <b>${esc(course)}</b>.</p>
          <p>Certificate ID: <b>${certificateId}</b><br/>Score: ${score}% · Grade ${grade}</p>
          <p><a href="${verifyLink}" style="color:#2f5fd0;font-weight:600">View / verify your certificate &rarr;</a></p>
        </div>`,
});

// a certificate sent by hand from LMS › Certificates (the PDF is attached)
const certificateSent = ({ name, certificateTitle, course, certificateId, verifyLink }) => ({
  subject: `🎓 Your certificate from Career Lab Consulting${course ? ` — ${course}` : ''}`,
  html: `<div style="font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#17202c;max-width:520px;margin:0 auto">
          <h2>Congratulations, ${esc(name)}!</h2>
          <p>Please find your <b>${esc(certificateTitle)}</b>${course ? ` for <b>${esc(course)}</b>` : ''} attached to this email.</p>
          <p>Certificate ID: <b>${certificateId}</b></p>
          <p><a href="${verifyLink}" style="color:#2f5fd0;font-weight:600">Verify your certificate &rarr;</a></p>
          <p style="color:#5b6575">— Team Career Lab Consulting</p>
        </div>`,
});

// short class notices (cancelled / postponed / marked absent / time changed)
const notice = (subject, body) => ({ subject, html: `<p>${body}</p>` });
// a new assignment for the learner (assignments.create)
const assignmentAssigned = ({ name, title, due, link, teacher }) => ({
  subject: `New assignment: ${title}`,
  html: card(
    `<p>Hi ${esc(name || 'there')},</p><p>${esc(teacher || 'Your Project Manager')} has given you a new assignment:</p><p style="font-size:17px;font-weight:600;margin:6px 0">${esc(title)}</p>${due ? `<p>Due: <b>${esc(due)}</b></p>` : ''}<p><a href="${esc(link)}" style="display:inline-block;background:#0e7490;color:#fff;padding:9px 18px;border-radius:8px;text-decoration:none">Open the assignment</a></p>`
  ),
});
const classCancelled = ({ classTitle, course, scheduledTime, reason }) => notice(`Class cancelled: ${classTitle}`, `${course} · was scheduled ${scheduledTime}. Reason: ${reason}`);
const classPostponed = ({ classTitle, course, fromTime, toTime, extra = '' }) => notice(`Class postponed: ${classTitle}`, `${course} · moved from ${fromTime} to ${toTime}.${extra}`);
const markedAbsent = ({ classTitle, course, classTime }) => notice(`Marked absent: ${classTitle}`, `${course} · ${classTime}. Contact your coordinator if this is incorrect.`);
const classRescheduled = ({ classTitle, course, fromTime, toTime }) => notice(`Class time changed: ${classTitle}`, `${course} · was ${fromTime}, now ${toTime}.`);

// automation reminder to a learner (services/lms/automationRules.js)
const automationLearner = ({ title, message, link }) => ({
  subject: title,
  html: card(`<h2 style="margin:0 0 8px;font-size:19px">${esc(title)}</h2><p style="color:#334;margin:0 0 16px">${esc(message)}</p>${link ? `<p style="margin:0 0 14px"><a href="${esc(link)}" style="display:inline-block;background:#0e7490;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open in the LMS</a></p>` : ''}<p style="color:#889;font-size:12px;margin:18px 0 0">CareerLab Consulting · InternX-AI</p>`),
});

const qualifiedDraft = ({ results, qualified }) => ({
  subject: `DRAFT — qualified / not-qualified report (${results} results)`,
  html: `<p>Draft status report for the last 7 days: <b>${qualified}</b> qualified, <b>${results - qualified}</b> not qualified.</p><p>Please verify before it is published. The full list is attached (CSV).</p>`,
});

const mgmtReport = ({ kind, label, kpis }) => ({
  subject: `${kind} LMS management report — ${label}`,
  html: `<h3 style="font-family:Arial">${kind} LMS report · ${label}</h3><table style="font-family:Arial;font-size:14px;border-collapse:collapse">${kpis.map(([n, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#555">${n}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`).join('')}</table><p style="font-family:Arial;font-size:12px;color:#888">Counts only — learner-level detail stays in the LMS (role-restricted).</p>`,
});

module.exports = {
  assignmentAssigned,
  esc,
  card,
  assessmentResult,
  assessmentSuspended,
  announcement,
  policyPublished,
  policyReminder,
  projectReview,
  attendanceEscalation,
  certificateIssued,
  certificateSent,
  classCancelled,
  classPostponed,
  markedAbsent,
  classRescheduled,
  automationLearner,
  qualifiedDraft,
  mgmtReport,
};
