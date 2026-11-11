// Every email the app sends by itself, for Messenger › Email (Email centre).
// `key` is what the sending code passes to sendMailWithRetry as templateKey;
// `when` is the real trigger in the code; `vars` are the {{placeholders}} an
// admin can use when editing. `sensitive` variables (passwords, login codes)
// are masked in the stored sample; `locked` emails can be viewed but not
// edited or switched off (login codes — a broken edit would lock people out).
// `timing` = the send time is editable here (read by the job that sends it).

const G = {
  lmsLearner: 'LMS · learners',
  lmsStaff: 'LMS · staff & management',
  support: 'Support tickets',
  finance: 'Fees & EMI',
  sales: 'Sales',
  hr: 'HR & accounts',
  auth: 'Login',
};

const CATALOG = [
  // ── LMS · learners ────────────────────────────────────────────────────────
  { key: 'lms-enrolment-welcome', group: G.lmsLearner, name: 'Enrollment confirmed (welcome + login details)', to: 'New learner', when: 'When a learner is enrolled (Student created with a login)', vars: ['name', 'course', 'batch', 'loginEmail', 'password', 'portalLink'], sensitive: ['password'] },
  { key: 'lms-batch-classes', group: G.lmsLearner, name: 'Your live classes (batch schedule)', to: 'Every learner of the batch', when: 'When a batch’s class schedule is created, and when a learner is added to a batch', vars: ['batch', 'course', 'trainer', 'scheduleHtml', 'joinLink'] },
  { key: 'lms-class-reminder', group: G.lmsLearner, name: 'Class starting soon', to: 'Learners of the class’s batch', when: 'Before each live class', vars: ['classTitle', 'course', 'batch', 'startTime', 'joinLink'], timing: { label: 'Minutes before the class', default: 10, min: 5, max: 180 } },
  { key: 'lms-class-cancelled', group: G.lmsLearner, name: 'Class cancelled', to: 'Learners of the batch', when: 'When a trainer / manager cancels a class', vars: ['classTitle', 'course', 'scheduledTime', 'reason'] },
  { key: 'lms-class-postponed', group: G.lmsLearner, name: 'Class postponed', to: 'Learners of the batch', when: 'When a class is postponed (and later classes shift)', vars: ['classTitle', 'course', 'fromTime', 'toTime'] },
  { key: 'lms-class-rescheduled', group: G.lmsLearner, name: 'Class time changed', to: 'Learners of the batch', when: 'Automation (every 10 min) — a class time was edited after the batch was told', vars: ['classTitle', 'course', 'fromTime', 'toTime'] },
  { key: 'lms-marked-absent', group: G.lmsLearner, name: 'Marked absent', to: 'Learner marked absent', when: 'When a class ends and attendance marks the learner absent', vars: ['classTitle', 'course', 'classTime'] },
  { key: 'lms-attendance-escalation', group: G.lmsLearner, name: 'Attendance check-in / warning (level 1–3)', to: 'Learner with low attendance', when: 'When Support Manager sends an escalation from the Attendance queue (the level text is written by the queue)', vars: ['name', 'level', 'status', 'bodyHtml'], dataBody: 'bodyHtml' },
  { key: 'lms-assessment-result', group: G.lmsLearner, name: 'Assessment result', to: 'Learner who took the test', when: 'Right after a test is submitted and scored', vars: ['name', 'testType', 'score', 'total', 'pct', 'status'] },
  { key: 'lms-project-review', group: G.lmsLearner, name: 'Project reviewed', to: 'Learner', when: 'When the PM reviews a project submission', vars: ['projectTitle', 'decision', 'feedback'] },
  { key: 'lms-certificate-issued', group: G.lmsLearner, name: 'Certificate issued', to: 'Learner', when: 'When a certificate is issued', vars: ['name', 'certificateTitle', 'course', 'certificateId', 'score', 'grade', 'verifyLink'] },
  { key: 'lms-policy-published', group: G.lmsLearner, name: 'New policy to acknowledge', to: 'Learners in the policy’s audience', when: 'When a policy is published', vars: ['policyTitle', 'version'] },
  { key: 'lms-policy-reminder', group: G.lmsLearner, name: 'Policy acknowledgement reminder', to: 'Learner with a pending acknowledgement', when: 'Daily until the policy is acknowledged', vars: ['policyTitle', 'version'] },
  { key: 'lms-feedback-reminder', group: G.lmsLearner, name: 'Weekly feedback reminder', to: 'Learners who have not given this week’s feedback', when: 'Sat 11:00 + Sun 17:00 (automation) and when a manager clicks Remind · max 2 a week', vars: ['name', 'due', 'feedbackLink'] },
  { key: 'lms-announcement', group: G.lmsLearner, name: 'Announcement', to: 'Chosen audience (all / batch / course)', when: 'When staff post an announcement with email ticked', vars: ['title', 'message', 'from'] },
  { key: 'lms-ops-announcement', group: G.lmsLearner, name: 'Approved mass message', to: 'Audience of the approved request', when: 'When Ops approves a mass-message request', vars: ['title', 'message', 'from'] },
  { key: 'lms-access-deactivated', group: G.lmsLearner, name: 'LMS access paused', to: 'Learner', when: 'When a learner’s LMS access is deactivated', vars: ['name', 'course', 'reason'] },
  { key: 'lms-access-activated', group: G.lmsLearner, name: 'LMS access active again', to: 'Learner', when: 'When a learner’s LMS access is restored', vars: ['name', 'course'] },
  { key: 'lms-automation-learner', group: G.lmsLearner, name: 'Automation reminder (learner)', to: 'Learner', when: 'Automation rules that email a learner', vars: ['title', 'message'] },

  // ── LMS · staff & management ───────────────────────────────────────────────
  { key: 'lms-daily-summary', group: G.lmsStaff, name: 'LMS daily summary', to: 'Management', when: 'Every day (daily summary job)', vars: ['date', 'classes', 'summaryHtml'], dataBody: 'summaryHtml' },
  { key: 'lms-unassigned-batch', group: G.lmsStaff, name: 'Candidates without a batch', to: 'Support team', when: 'Every day while any active candidate has no batch', vars: ['count', 'listHtml'], dataBody: 'listHtml' },
  { key: 'lms-qualified-draft', group: G.lmsStaff, name: 'Qualified / not-qualified report (draft)', to: 'Management', when: 'Monday 10:00 (automation)', vars: ['results', 'qualified'] },
  { key: 'lms-mgmt-report', group: G.lmsStaff, name: 'Weekly / monthly management report', to: 'Management', when: 'Monday 09:00 (last week) and the 1st 09:00 (last month)', vars: ['period', 'kpiHtml'] },

  // ── Support ──────────────────────────────────────────────────────────────
  { key: 'support-new-ticket', group: G.support, name: 'New ticket raised', to: 'Support inbox (SUPPORT_EMAIL)', when: 'When anyone raises a ticket', vars: ['ticketNo', 'subject', 'category', 'priority', 'raisedBy'] },
  { key: 'support-ticket-resolved', group: G.support, name: 'Your ticket is resolved', to: 'Person who raised the ticket', when: 'When a ticket is resolved (Support queue, SM board or a problem record)', vars: ['ticketNo', 'subject', 'name', 'resolution', 'resolvedBy'] },

  // ── Fees & EMI ───────────────────────────────────────────────────────────
  { key: 'finance-payment-link', group: G.finance, name: 'Fee payment request (link + QR)', to: 'Learner / candidate', when: 'When a payment link is created (also 10 days before each EMI)', vars: ['name', 'course', 'amount', 'payLink'] },
  { key: 'finance-emi-reminder', group: G.finance, name: 'EMI due reminder', to: 'Learner with an EMI due', when: '10, 7 and 5 days before the due date, then daily until it is paid', vars: ['name', 'course', 'amount', 'dueDate', 'daysLeft', 'payLink'] },
  { key: 'finance-kyc', group: G.finance, name: 'Finance (EMI) application — KYC', to: 'Applicant', when: 'When an EMI finance application is created', vars: ['name', 'course', 'kycLink'] },

  // ── Sales ────────────────────────────────────────────────────────────────
  { key: 'sales-demo-customer', group: G.sales, name: 'Live demo booked / moved (customer)', to: 'Customer', when: 'When a demo is booked, or moved after a no-show', vars: ['name', 'day'] },
  { key: 'sales-demo-staff', group: G.sales, name: 'Demo booked (agent / team leader)', to: 'Agent and team leader', when: 'When a demo is booked or rebooked', vars: ['customer', 'day', 'agent'] },
  { key: 'sales-daily-user', group: G.sales, name: 'Your prospects and callbacks today', to: 'Each sales user', when: 'Every morning', vars: ['prospects', 'callbacks', 'day'] },
  { key: 'sales-daily-team', group: G.sales, name: 'Team prospects and callbacks', to: 'Sales management', when: 'Every morning', vars: ['day'] },
  { key: 'sales-prospect-verify', group: G.sales, name: 'Prospect to verify', to: 'Verifier', when: 'When an agent sends a prospect for verification', vars: ['lead', 'from'] },
  { key: 'sales-missed-calls', group: G.sales, name: 'You missed calls today', to: 'Agent who missed routed calls', when: 'End of day, when an agent missed at least one call', vars: ['missed', 'date'] },

  // ── HR & accounts ─────────────────────────────────────────────────────────
  { key: 'hr-account-welcome', group: G.hr, name: 'Account ready (department staff)', to: 'New staff user', when: 'When a staff account is created', vars: ['name', 'department', 'loginEmail', 'loginLink'] },
  { key: 'hr-sales-welcome', group: G.hr, name: 'CRM account ready (sales)', to: 'New sales user', when: 'When a sales account is created', vars: ['name', 'loginEmail', 'loginLink'] },
  { key: 'hr-no-logout', group: G.hr, name: 'You didn’t log out today', to: 'Sales user who did not log out', when: 'End of the work day', vars: ['name', 'day'] },
  { key: 'hr-leave-request', group: G.hr, name: 'Leave request (for approval)', to: 'Leave approver', when: 'When a user applies for leave', vars: ['employee', 'duration'] },

  // ── Login ────────────────────────────────────────────────────────────────
  { key: 'auth-otp', group: G.auth, name: 'Login code (OTP)', to: 'Person signing in', when: 'On every login request — valid 10 minutes', vars: ['name', 'otp'], sensitive: ['otp'], locked: true },
];

const byKey = (k) => CATALOG.find((c) => c.key === k) || null;

module.exports = { CATALOG, GROUPS: G, byKey };
