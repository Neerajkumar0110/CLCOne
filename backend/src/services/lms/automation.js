const mongoose = require('mongoose');

// Design A8 "Automation catalogue" — the 16 workflows of spec §17.1. `job`
// names the background job that really runs the rule; only those can be
// paused from the screen (the job calls isPaused() before acting). Rules with
// no job are shown as not automated yet instead of a fake toggle.
const RULES = [
  { key: 'pre-session-reminder', n: 'Pre-session reminder', t: 'Calendar has topic/time/link', a: 'Reminder to correct batch, log delivery', h: 'Missing data alerts owner', job: 'lmsLiveTick', pausable: false },
  { key: 'attendance-absence', n: 'Attendance / absence', t: 'Attendance synced + reconciled', a: 'Absence list, check-in form', h: 'No "disengaged" label by automation', job: 'lmsLiveTick', pausable: false },
  { key: 'assessment-coordination', n: 'Assessment coordination', t: 'Schedule + roster', a: 'Reminders, pending-attempt report', h: 'Result verified before release' },
  { key: 'weekly-feedback', n: 'Weekly feedback', t: 'Window opens / closes', a: 'Send form, limited reminders, summary', h: 'Serious feedback → authorised person' },
  { key: 'onboarding', n: 'Onboarding', t: 'Enrollment verified', a: 'Checklist, welcome, setup tasks', h: 'Complete only after checks' },
  { key: 'software-setup', n: 'Software setup', t: 'Requirements + device', a: 'Setup guide, ticket if stuck', h: 'Remote install only with permission' },
  { key: 'ticket-creation', n: 'Ticket creation', t: 'Query from approved channel', a: 'Ticket, category, SLA, ack', h: 'Critical / overdue escalate' },
  { key: 'query-assistance', n: 'Query assistance (AI)', t: 'Message received', a: 'Classify, suggest FAQ, ticket', h: 'AI drafts reviewed' },
  { key: 'session-change', n: 'Session / curriculum change', t: 'Approved change', a: 'Notify affected batch only', h: 'History maintained' },
  { key: 'project-due', n: 'Project due dates', t: 'Milestone due / overdue', a: 'Remind learner + PM, exception report', h: 'Extensions only by rule' },
  { key: 'referral-handoff', n: 'Referral handoff', t: 'Referral recorded', a: 'Track follow-up → onboarding', h: 'Respect channel consent' },
  { key: 'qualified-report', n: 'Qualified / disqualified report', t: 'Results available', a: 'Draft status report', h: 'Owner verifies before publish' },
  { key: 'recording-processing', n: 'Recording processing', t: 'Recording available', a: 'Metadata, transcript, alerts', h: 'Publish after playback check', job: 'lmsLiveTick', pausable: false },
  { key: 'daily-report', n: 'Daily operations report', t: 'Daily 9 AM', a: 'Sessions, absences, tickets, failed jobs', h: 'Owner records actions', job: 'lmsDailySummaryTick', pausable: true },
  { key: 'mgmt-report', n: 'Weekly / monthly mgmt report', t: 'Period closes', a: 'KPIs, trends, SLA, actions', h: 'Sensitive detail role-restricted' },
  { key: 'policy-reminder', n: 'Policy reminder', t: 'Pending acknowledgement', a: 'Daily reminder till accepted', h: 'Stops on Dropped / Archived', job: 'lmsPolicyReminderTick', pausable: true },
  // gap fixes (DATA-02 / approvals): the system detects and carries out, a person approves
  { key: 'duplicate-class', n: 'Duplicate class detection', t: 'Two classes of a batch overlap', a: 'Removal request to Ops (hourly)', h: 'Removed only after Ops approves', job: 'lmsOpsAutoTick', pausable: true },
  { key: 'approval-execute', n: 'Approved request follow-through', t: 'Ops approval final', a: 'Status / message / extension / class / certificate applied', h: 'Only after the final approver', job: 'approvalExecutor', pausable: false },
];

let cache = null;
let cachedAt = 0;

async function pausedMap() {
  if (cache && Date.now() - cachedAt < 15000) return cache;
  const row = await mongoose.model('LmsAdminConfig').findOne({ key: 'automation' }).lean();
  cache = (row && row.value && row.value.paused) || {};
  cachedAt = Date.now();
  return cache;
}

// Fail-open: a config read error must never stop a real job.
async function isPaused(key) {
  try {
    return !!(await pausedMap())[key];
  } catch (e) {
    return false;
  }
}

function invalidate() {
  cache = null;
}

module.exports = { RULES, pausedMap, isPaused, invalidate };
