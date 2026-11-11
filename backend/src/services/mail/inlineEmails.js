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

const projectReview = ({ projectTitle, decision, feedback }) => ({
  subject: `Project review — ${projectTitle}: ${decision}`,
  html: `<p>Your project <b>${esc(projectTitle)}</b> was reviewed.</p><p>Decision: <b>${esc(decision)}</b></p>${feedback ? `<p>${esc(feedback)}</p>` : ''}`,
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

// short class notices (cancelled / postponed / marked absent / time changed)
const notice = (subject, body) => ({ subject, html: `<p>${body}</p>` });
const classCancelled = ({ classTitle, course, scheduledTime, reason }) => notice(`Class cancelled: ${classTitle}`, `${course} · was scheduled ${scheduledTime}. Reason: ${reason}`);
const classPostponed = ({ classTitle, course, fromTime, toTime, extra = '' }) => notice(`Class postponed: ${classTitle}`, `${course} · moved from ${fromTime} to ${toTime}.${extra}`);
const markedAbsent = ({ classTitle, course, classTime }) => notice(`Marked absent: ${classTitle}`, `${course} · ${classTime}. Contact your coordinator if this is incorrect.`);
const classRescheduled = ({ classTitle, course, fromTime, toTime }) => notice(`Class time changed: ${classTitle}`, `${course} · was ${fromTime}, now ${toTime}.`);

// automation reminder to a learner (services/lms/automationRules.js)
const automationLearner = ({ title, message, link }) => ({ subject: title, html: `<p>${message}</p>${link ? `<p><a href="${link}">Open</a></p>` : ''}` });

const qualifiedDraft = ({ results, qualified }) => ({
  subject: `DRAFT — qualified / not-qualified report (${results} results)`,
  html: `<p>Draft status report for the last 7 days: <b>${qualified}</b> qualified, <b>${results - qualified}</b> not qualified.</p><p>Please verify before it is published. The full list is attached (CSV).</p>`,
});

const mgmtReport = ({ kind, label, kpis }) => ({
  subject: `${kind} LMS management report — ${label}`,
  html: `<h3 style="font-family:Arial">${kind} LMS report · ${label}</h3><table style="font-family:Arial;font-size:14px;border-collapse:collapse">${kpis.map(([n, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#555">${n}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`).join('')}</table><p style="font-family:Arial;font-size:12px;color:#888">Counts only — learner-level detail stays in the LMS (role-restricted).</p>`,
});

module.exports = {
  esc,
  card,
  assessmentResult,
  announcement,
  policyPublished,
  policyReminder,
  projectReview,
  attendanceEscalation,
  certificateIssued,
  classCancelled,
  classPostponed,
  markedAbsent,
  classRescheduled,
  automationLearner,
  qualifiedDraft,
  mgmtReport,
};
