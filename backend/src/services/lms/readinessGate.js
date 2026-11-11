const mongoose = require('mongoose');
const assessmentSettings = require('./assessmentSettingsService');

// Readiness access gate (decision D-02, Admin & Ops › Rules "Access gate:
// Readiness_Status = Passed"). The BASIC test is the readiness test; while
// the gate is ON, a learner can only START a later test (MAJOR, MICRO,
// NLP_*, LLM_*) once they have passed BASIC at the readiness pass %.
//
// It never takes away something a learner already has:
//   • gate OFF (LmsSetting('assessments').readinessGate) → no effect at all;
//   • a learner who already attempted that test type keeps going (their
//     remaining attempts / cooldown are still the normal rules);
//   • a manager's unlock exception for that test (AssessmentUnlockOverride,
//     batch or learner) also opens this gate — one exception mechanism.

const READINESS_TEST = 'BASIC';

// Passed = a SUBMITTED BASIC attempt that qualified. Old attempts saved
// before `qualified` existed are judged by score / total, the same fallback
// the results page uses.
async function readinessStatus(candidateId, email) {
  const { qualifyThreshold } = await assessmentSettings.get();
  const or = [];
  if (candidateId) or.push({ candidate: candidateId });
  if (email) or.push({ candidateEmail: email });
  if (!or.length) return { status: 'Not taken', bestPct: null, attempts: 0, passPct: Math.round(qualifyThreshold * 100) };
  const rows = await mongoose
    .model('AssessmentAttempt')
    .find({ testType: READINESS_TEST, status: { $in: ['SUBMITTED', 'SUSPENDED'] }, $or: or })
    .select('status score totalCount qualified')
    .lean();
  let best = null;
  let passed = false;
  for (const a of rows) {
    const pct = a.totalCount ? Math.round((a.score / a.totalCount) * 100) : null;
    if (pct !== null && (best === null || pct > best)) best = pct;
    const q = a.qualified !== undefined && a.qualified !== null ? a.qualified : a.status === 'SUBMITTED' && a.totalCount ? a.score / a.totalCount >= qualifyThreshold : false;
    if (q) passed = true;
  }
  return { status: passed ? 'Passed' : rows.length ? 'Not passed' : 'Not taken', bestPct: best, attempts: rows.length, passPct: Math.round(qualifyThreshold * 100) };
}

// { allowed, reason, readiness } for starting `testType`.
async function check({ testType, candidateId, email, batch }) {
  if (testType === READINESS_TEST) return { allowed: true };
  const s = await assessmentSettings.get();
  if (!s.readinessGate) return { allowed: true };
  const readiness = await readinessStatus(candidateId, email);
  if (readiness.status === 'Passed') return { allowed: true, readiness };
  const or = [];
  if (candidateId) or.push({ candidate: candidateId });
  if (email) or.push({ candidateEmail: email });
  const already = or.length ? await mongoose.model('AssessmentAttempt').exists({ testType, $or: or }) : null;
  if (already) return { allowed: true, readiness, grandfathered: true };
  const { hasUnlockOverride } = require('./curriculumTracker');
  if (await hasUnlockOverride({ testType, batch, candidateId })) return { allowed: true, readiness, exception: true };
  const reason =
    readiness.status === 'Not taken'
      ? `Pass the Readiness test first (${readiness.passPct}% needed) — this test opens after that.`
      : `Pass the Readiness test first — you need ${readiness.passPct}% (your best so far: ${readiness.bestPct == null ? '—' : `${readiness.bestPct}%`}).`;
  return { allowed: false, reason, readiness };
}

module.exports = { check, readinessStatus, READINESS_TEST };
