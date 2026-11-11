// Every system email, built by the SAME function that sends it, with sample
// values — so Messenger › Email shows each email exactly as it lands in an
// inbox (header, button, footer and all) before it has ever been sent, and
// the editor starts from that full design with {{placeholders}} in place of
// the sample values (services/mail/emailTemplates.js#toTemplate).
// key → () => { subject, html, vars }   (vars = the sample values used)

const BASE = 'https://clcone.careerlabconsulting.com';
const NOW = new Date('2026-11-17T12:30:00Z'); // Mon 17 Nov, 6:00 pm IST
const at = (min) => new Date(NOW.getTime() + min * 60000);
const L = (p) => require(p);

const NAME = 'Asha Verma';
const EMAIL = 'asha.verma@example.com';
const COURSE = 'AI & ML Internship';
const BATCH = 'AI-ML Batch 12';

const P = {
  'lms-enrolment-welcome': () => {
    const vars = { name: NAME, course: COURSE, batch: BATCH, loginEmail: EMAIL, password: 'Asha@4821', portalLink: `${BASE}/#/learn` };
    const doc = { name: NAME, email: EMAIL, course: COURSE, batch: BATCH, feeGrandTotal: 25000, feePaid: 5000, feeDue: 20000 };
    const plan = { planTotal: 25000, paidTotal: 5000, remaining: 20000 };
    // the logo travels as an inline attachment (cid:) — for the screen it is shown from the file
    const images = {};
    try {
      const p = require('path').join(__dirname, '..', 'lms', 'assets', 'clc-logo.png');
      images['cid:clc-enrollment-logo'] = `data:image/png;base64,${require('fs').readFileSync(p).toString('base64')}`;
    } catch (e) {
      /* no logo file */
    }
    return { subject: `Welcome to ${COURSE} — enrollment confirmed`, html: L('../lms/studentAccountService')._emailHtml.enrollmentEmailHtml(doc, { crmLink: vars.portalLink, rawPassword: vars.password, plan }), vars, images };
  },
  'lms-batch-classes': () => {
    const m = L('../lms/mailer')._emailHtml;
    const payload = { batchName: BATCH, courseTitle: COURSE, teacherName: 'Rohit Kumar', schedule: { days: 'Mon, Wed, Fri', time: '6:00 PM', durationMin: 90, from: at(0), to: at(60 * 24 * 60) }, sessions: [{ scheduledStart: at(0) }, { scheduledStart: at(2 * 1440) }, { scheduledStart: at(4 * 1440) }], joinPageUrl: `${BASE}/#/lms/classes` };
    const { fmtDateTime } = L('../../utils/emailFormat');
    const { escHtml } = L('../../utils/emailFormat');
    const rows = payload.sessions.map((s) => `<li style="margin:2px 0">${escHtml(fmtDateTime(s.scheduledStart))}</li>`).join('');
    const vars = { batch: BATCH, course: COURSE, trainer: 'Rohit Kumar', scheduleHtml: m.batchScheduleHtml({ schedule: payload.schedule, rows }), joinLink: payload.joinPageUrl };
    return { subject: `Your live classes — ${BATCH}`, html: m.batchClassEmailHtml(payload), vars };
  },
  'lms-class-reminder': async () => {
    const minutes = (await L('./emailTemplates').timing('lms-class-reminder')) || 10;
    const { fmtDateTime } = L('../../utils/emailFormat');
    const p = { title: 'Python basics — Class 4', courseTitle: COURSE, batchName: BATCH, scheduledStart: at(0), joinPageUrl: `${BASE}/#/lms/classes`, minutes };
    const vars = { classTitle: p.title, course: COURSE, batch: BATCH, startTime: fmtDateTime(p.scheduledStart), joinLink: p.joinPageUrl };
    return { subject: `Starting in ${minutes} min — ${p.title}`, html: L('../lms/mailer')._emailHtml.liveClassReminderEmailHtml(p), vars };
  },
  'lms-class-cancelled': () => {
    const vars = { classTitle: 'Python basics — Class 4', course: COURSE, scheduledTime: '17/11/2026, 6:00:00 pm', reason: 'Trainer unwell' };
    return { ...L('./inlineEmails').classCancelled(vars), vars };
  },
  'lms-class-postponed': () => {
    const vars = { classTitle: 'Python basics — Class 4', course: COURSE, fromTime: '17/11/2026, 6:00:00 pm', toTime: '18/11/2026, 6:00:00 pm', extra: '' };
    return { ...L('./inlineEmails').classPostponed(vars), vars };
  },
  'lms-class-rescheduled': () => {
    const vars = { classTitle: 'Python basics — Class 4', course: COURSE, fromTime: 'Mon, 17 Nov, 6:00 pm', toTime: 'Mon, 17 Nov, 7:00 pm' };
    return { ...L('./inlineEmails').classRescheduled(vars), vars };
  },
  'lms-marked-absent': () => {
    const vars = { classTitle: 'Python basics — Class 4', course: COURSE, classTime: '17/11/2026, 6:00:00 pm' };
    return { ...L('./inlineEmails').markedAbsent(vars), vars };
  },
  'lms-attendance-escalation': () => {
    const body = 'Dear Asha,\nOur attendance record shows that you missed the session held on 17/11/2026. We are checking in to understand whether everything is alright.\nTotal sessions: 12 · Attended: 10 · Current: 83%';
    const m = L('./inlineEmails').attendanceEscalation({ subject: 'Attendance Check-In — Recent Missed Session', body });
    return { ...m, vars: { name: NAME, level: 1, status: 'missed 1 · 83%', bodyHtml: m.html.replace(/<p>— Career Lab Support<\/p>$/, '') } };
  },
  'lms-assessment-result': () => {
    const vars = { name: NAME, testType: 'MAJOR', score: 42, total: 50, pct: 84, status: 'Not qualified' };
    return { ...L('./inlineEmails').assessmentResult(vars), vars };
  },
  'lms-project-review': () => {
    const vars = { projectTitle: 'Sales forecasting model', decision: 'revision requested', feedback: 'Add a validation split and explain the metrics.' };
    return { ...L('./inlineEmails').projectReview(vars), vars };
  },
  'lms-certificate-issued': () => {
    const vars = { name: NAME, certificateTitle: 'Certificate of Completion', course: COURSE, certificateId: 'CLC-2026-00412', score: 88, grade: 'A', verifyLink: `${BASE}/verify/CLC-2026-00412` };
    return { ...L('./inlineEmails').certificateIssued(vars), vars };
  },
  'lms-policy-published': () => {
    const vars = { policyTitle: 'Attendance & Conduct Policy', version: '1.0', mandatory: true };
    return { ...L('./inlineEmails').policyPublished(vars), vars };
  },
  'lms-policy-reminder': () => {
    const vars = { policyTitle: 'Attendance & Conduct Policy', version: '1.0' };
    return { ...L('./inlineEmails').policyReminder(vars), vars };
  },
  'lms-feedback-reminder': () => {
    const html = null; // built inside feedback.js#emailReminder — rendered there with these values
    return { subject: 'Reminder: weekly feedback is due', html, vars: { name: NAME, due: 'Sun, 11:59 pm', feedbackLink: `${BASE}/learn/feedback` }, builder: 'feedback' };
  },
  'lms-announcement': () => {
    const vars = { title: 'Holiday on Friday', message: 'There is no class this Friday. Classes resume on Monday at the usual time.', from: 'Support Team', course: COURSE };
    return { ...L('./inlineEmails').announcement(vars), vars };
  },
  'lms-ops-announcement': () => {
    const vars = { title: 'Schedule change for next week', message: 'All batches move to 7:00 PM next week.', from: 'Operations' };
    return { ...L('./inlineEmails').announcement(vars), vars };
  },
  'lms-access-deactivated': () => {
    const s = { name: NAME, course: COURSE, accessDisabledReason: 'Fee overdue' };
    return { subject: 'Your Career Lab Consulting LMS access has been deactivated', html: L('../lms/candidateAccess')._emailHtml.deactivatedMail(s), vars: { name: NAME, course: COURSE, reason: 'Fee overdue' } };
  },
  'lms-access-activated': () => {
    const s = { name: NAME, course: COURSE };
    return { subject: 'Your Career Lab Consulting LMS access is active again', html: L('../lms/candidateAccess')._emailHtml.activatedMail(s), vars: { name: NAME, course: COURSE } };
  },
  'lms-automation-learner': () => {
    const vars = { title: 'Your MAJOR test is open', message: 'This test is open for you and not attempted yet. Take it from your Assessments page.', link: `${BASE}/learn/assessment-dashboard` };
    return { ...L('./inlineEmails').automationLearner(vars), vars };
  },
  'lms-daily-summary': () => {
    const s = {
      date: NOW, classesHeld: 2, classesCancelled: 0, avgAttendancePct: 86, present: 31, absent: 5, late: 2, partial: 1, excused: 0, deactivated: [],
      classes: [
        { batch: BATCH, title: 'Python basics — Class 4', teacher: 'Rohit Kumar', n: 20, joined: 18, present: 17, late: 1, absent: 3, partial: 0, avgPct: 85, absentNames: ['Ravi', 'Neha', 'Aman'] },
        { batch: 'Data Science Batch 7', title: 'Pandas — Class 9', teacher: 'Priya Singh', n: 16, joined: 15, present: 14, late: 1, absent: 2, partial: 1, avgPct: 88, absentNames: ['Karan', 'Isha'] },
      ],
    };
    const h = L('../../jobs/lmsDailySummaryTick').emailHtml.summaryHtml(s);
    return { subject: `LMS daily summary — 17 Nov · 2 classes · 86% attendance`, html: h, vars: { date: '17 Nov', classes: 2, summaryHtml: h } };
  },
  'lms-unassigned-batch': () => {
    const rows = [{ name: 'Ravi Kumar', email: 'ravi@example.com', course: COURSE }, { name: 'Neha Gupta', email: 'neha@example.com', course: 'Data Science Internship' }];
    const h = L('../../jobs/lmsUnassignedBatchTick').emailHtml.summaryHtml(2, rows);
    return { subject: '2 candidates need a batch assigned', html: h, vars: { count: 2, listHtml: h } };
  },
  'lms-qualified-draft': () => {
    const vars = { results: 24, qualified: 15 };
    return { ...L('./inlineEmails').qualifiedDraft(vars), vars };
  },
  'lms-mgmt-report': () => {
    const kpis = [['Classes held', 18], ['Attendance (present + late)', '87% of 410 records'], ['Tickets opened', 12], ['Tickets resolved', 11], ['Tickets escalated (SLA / manual)', 1], ['Feedback responses', 64], ['New learners', 9]];
    const vars = { kind: 'Weekly', label: '2026-11-10 to 2026-11-16' };
    return { ...L('./inlineEmails').mgmtReport({ ...vars, kpis }), vars };
  },
  'support-new-ticket': () => {
    const t = { _id: '6a0000000000000000001234', subject: 'Cannot join live class', category: 'Live class / join', priority: 'High', source: 'student', raisedByName: NAME, raisedByEmail: EMAIL, raisedByPhone: '98xxxxxx10', description: 'The Join button keeps loading.', created: NOW };
    const no = L('../../config/supportTickets').ticketNo(t);
    return { subject: `[${no}] New ${t.category} ticket — ${t.subject}`, html: L('../support/ticketMail')._emailHtml.newTicketHtml(t), vars: { ticketNo: no, subject: t.subject, category: t.category, priority: t.priority, raisedBy: NAME } };
  },
  'support-ticket-resolved': () => {
    const t = { _id: '6a0000000000000000001234', subject: 'Cannot join live class', category: 'Live class / join', source: 'student', raisedByName: NAME, resolvedByName: 'Support Team', resolvedAt: NOW, resolutionNote: 'Please clear the browser cache and use Chrome. Your access is working now.', created: NOW };
    const no = L('../../config/supportTickets').ticketNo(t);
    return { subject: `[${no}] Resolved — ${t.subject}`, html: L('../support/ticketMail')._emailHtml.resolvedHtml(t), vars: { ticketNo: no, subject: t.subject, name: NAME, resolution: t.resolutionNote, resolvedBy: 'Support Team' } };
  },
  'finance-payment-link': () => {
    const amount = 25000;
    const fmtInr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
    const p = { name: NAME, course: COURSE, amount, shortUrl: 'https://rzp.io/l/sample', installmentNo: 1 };
    return { subject: `Registration fee payment request — ${fmtInr(amount)} (${COURSE})`, html: L('../payments/mailer')._emailHtml.paymentLinkEmailHtml(p), vars: { name: NAME, course: COURSE, amount: fmtInr(amount), payLink: p.shortUrl } };
  },
  'finance-emi-reminder': () => {
    const amount = 5000;
    const fmtInr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
    const p = { name: NAME, course: COURSE, amount, dueAt: at(5 * 1440), daysUntilDue: 5, shortUrl: 'https://rzp.io/l/sample' };
    return { subject: `EMI due in 5 days — ${fmtInr(amount)} (${COURSE})`, html: L('../payments/mailer')._emailHtml.emiReminderEmailHtml(p), vars: { name: NAME, course: COURSE, amount: fmtInr(amount), daysLeft: 5, payLink: p.shortUrl } };
  },
  'finance-kyc': () => {
    const app = { studentName: NAME, studentEmail: EMAIL, course: COURSE, courseFee: 25000, financeAmount: 20000, tenureMonths: 6, publicToken: 'sample-token' };
    const fa = L('../payments/financeApplications');
    return { subject: `Finance (EMI) application — complete your KYC (${COURSE})`, html: fa._emailHtml.financeKycEmailHtml(app), vars: { name: NAME, course: COURSE, kycLink: fa.kycLink(app.publicToken) } };
  },
  'sales-demo-customer': () => {
    const d = L('../sales/demoBookings');
    const b = { name: NAME, phone: '98xxxxxx10', email: EMAIL, date: at(1440), agentName: 'Karan Mehta', tokens: { customer: 'sample', agent: 'sample', leader: 'sample' } };
    const day = d.fmtDay(b.date);
    return { subject: `Your live demo — ${day}, 6:00 PM`, html: d._emailHtml.customerHtml(b, { rebooked: false }), vars: { name: NAME, day } };
  },
  'sales-demo-staff': () => {
    const d = L('../sales/demoBookings');
    const b = { name: NAME, phone: '98xxxxxx10', email: EMAIL, date: at(1440), agentName: 'Karan Mehta', tokens: { customer: 'sample', agent: 'sample', leader: 'sample' } };
    const day = d.fmtDay(b.date);
    return { subject: `Demo booked: ${NAME} — ${day}, 6 PM`, html: d._emailHtml.staffHtml(b, 'agent', { rebooked: false }), vars: { customer: NAME, day, agent: 'Karan Mehta' } };
  },
  'sales-daily-user': () => {
    const r = { name: 'Karan Mehta', prospects: [{ name: NAME, phone: '98xxxxxx10', at: NOW, remarks: 'Interested in AI course' }], callbacks: [{ name: 'Ravi Kumar', phone: '97xxxxxx22', callBackAt: at(1440), remarks: 'Call after 6' }], due: [] };
    const h = L('../../jobs/salesDailyMailTick').emailHtml.userHtml(r, 'Mon, 17 Nov');
    return { subject: 'Today: 1 prospects, 1 callbacks', html: h, vars: { prospects: 1, callbacks: 1, day: 'Mon, 17 Nov' } };
  },
  'sales-daily-team': () => {
    const report = [{ name: 'Karan Mehta', prospects: [1, 2, 3], callbacks: [1], due: [1] }, { name: 'Priya Singh', prospects: [1], callbacks: [1, 2], due: [] }];
    const h = L('../../jobs/salesDailyMailTick').emailHtml.teamHtml(report, 'Mon, 17 Nov');
    return { subject: 'Daily prospects and callbacks · Mon, 17 Nov', html: h, vars: { day: 'Mon, 17 Nov' } };
  },
  'sales-prospect-verify': () => {
    const lead = { name: NAME, phone: '98xxxxxx10', email: EMAIL, city: 'Delhi', education: 'B.Tech', source: 'Facebook', remarks: 'Wants weekend batch', stageHistory: [] };
    const h = L('../../controllers/appControllers/operation/callingController/prospectSend')._emailHtml.emailHtml({ lead, calls: [], from: 'Karan Mehta', note: 'Ready to pay this week', missing: [] });
    return { subject: `Prospect to verify: ${NAME} (from Karan Mehta)`, html: h, vars: { lead: NAME, from: 'Karan Mehta' } };
  },
  'sales-missed-calls': () => {
    const h = L('../../jobs/missedCallDailySummaryTick').emailHtml.summaryHtml(3, 'Mon, 17 Nov');
    return { subject: 'You missed 3 calls today', html: h, vars: { missed: 3, date: 'Mon, 17 Nov' } };
  },
  'hr-account-welcome': () => {
    const w = L('../auth/departmentWelcomeEmail');
    const loginLink = L('../sales/salesWelcomeEmail').loginUrl();
    return { subject: 'Your Finance account is ready — login details inside', html: w.departmentWelcomeHtml({ name: NAME, email: EMAIL, role: 'Finance', department: 'Finance', hasLms: false }), vars: { name: NAME, department: 'Finance', loginEmail: EMAIL, loginLink } };
  },
  'hr-sales-welcome': () => {
    const s = L('../sales/salesWelcomeEmail');
    return { subject: 'Your CRM account is ready — login details inside', html: s.salesWelcomeEmailHtml({ name: NAME, email: EMAIL }), vars: { name: NAME, loginEmail: EMAIL, loginLink: s.loginUrl() } };
  },
  'hr-no-logout': () => {
    const vars = { name: NAME, loginTime: '11:02 am', shiftEnd: '19:00', day: '2026-11-17' };
    return { ...L('../hr/workday')._emailHtml.noLogoutEmail(vars), vars };
  },
  'hr-leave-request': () => {
    const vars = { employee: NAME, role: 'Executive', leaveType: 'Casual', when: '20 Nov (full day)', reason: 'Family function', approveLink: `${BASE}/api/workday-public/leave-decision?action=approve`, rejectLink: `${BASE}/api/workday-public/leave-decision?action=reject` };
    return { ...L('../hr/workday')._emailHtml.leaveEmail(vars), vars };
  },
  'auth-otp': () => {
    const vars = { name: NAME, otp: '482913' };
    return { subject: '482913 is your Career Lab Consulting login code', html: L('../../emailTemplate/otpEmail').otpEmail({ name: NAME, otp: '482913', brand: 'Career Lab Consulting', minutes: 10 }), vars };
  },
};

// → { subject, html, vars } | null
async function build(key) {
  const fn = P[key];
  if (!fn) return null;
  try {
    const r = await fn();
    if (r && r.builder === 'feedback') {
      r.html = await L('../../controllers/appControllers/lms/lmsController/feedback')._feedbackReminderHtml(r.vars);
    }
    return r && r.html ? r : null;
  } catch (e) {
    console.error(`[email] preview for ${key} failed:`, e.message);
    return null;
  }
}

module.exports = { build, keys: Object.keys(P) };
