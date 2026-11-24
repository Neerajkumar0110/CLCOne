const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const mongoose = require('mongoose');
const A = require('../../../../../services/lms/growth/access');
const flags = require('../../../../../services/lms/growth/flags');
const runner = require('../../../../../services/lms/growth/qaRunner');
const qaLog = require('../../../../../services/lms/growth/qaLog');

// QA (testing) environment screens (Figma 4A–4E) — admins (dev & QA teams).
// What this server can know for real, it reports for real: its own version /
// git commit / uptime, the built-in test runs, server errors, the QA test
// accounts. Releases, sign-offs, bugs, test cases and flags are managed here.
// Promote / roll back RECORD the decision; the code itself is deployed with
// the deploy script on the server.

const M = (n) => mongoose.model(n);
const ok = (res, result, message) => res.status(200).json({ success: true, result, message });
const bad = (res, code, message) => res.status(code).json({ success: false, result: null, message });
const str = (v, n = 300) => String(v == null ? '' : v).trim().slice(0, n);
const guard = (req, res) => {
  if (!A.isAdmin(req.admin)) {
    bad(res, 403, 'QA area — dev & QA team (admins) only.');
    return false;
  }
  return true;
};
const DEF_QA = {
  autoRollback: true,
  access: { sso: true, ipAllowlist: true, noIndex: true, guests: false },
  teams: { dev: [], qa: [] },
};
async function qaSettings() {
  const row = await M('LmsGrowthConfig').findOne({ key: 'live' }).select('qa').lean();
  const q = (row && row.qa) || {};
  return { ...DEF_QA, ...q, access: { ...DEF_QA.access, ...(q.access || {}) }, teams: { ...DEF_QA.teams, ...(q.teams || {}) } };
}

const git = (args) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd: path.resolve(process.cwd(), '..'), timeout: 4000 }, (err, out) => resolve(err ? null : String(out).trim()));
  });

async function serverInfo() {
  const [commit, branch, when, ahead] = await Promise.all([git(['rev-parse', '--short', 'HEAD']), git(['rev-parse', '--abbrev-ref', 'HEAD']), git(['log', '-1', '--format=%cI']), git(['rev-list', '--count', '@{u}..HEAD'])]);
  let version = '';
  try {
    version = require(path.resolve(process.cwd(), 'package.json')).version;
  } catch (_) {
    version = '';
  }
  return { version, commit, branch, committedAt: when, aheadOfRemote: ahead == null ? null : Number(ahead), uptimeSec: Math.round(process.uptime()), host: os.hostname(), env: process.env.LMS_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development'), dbSeparate: !!(process.env.QA_DATABASE && process.env.QA_DATABASE !== process.env.DATABASE) };
}

// gates for a release (4A "Quality gates")
async function gates(rel) {
  const run = await M('LmsTestRun').findOne({ status: 'done', ...(rel ? { $or: [{ release: rel.version }, {}] } : {}) }).sort({ number: -1 }).lean();
  const runFor = rel ? (await M('LmsTestRun').findOne({ status: 'done', release: rel.version }).sort({ number: -1 }).lean()) || run : run;
  const s = (runFor && runFor.suites) || {};
  const blockers = rel ? await M('LmsBug').countDocuments({ release: rel.version, removed: false, severity: { $in: ['Critical', 'High'] }, status: { $in: ['open', 'in_progress'] } }) : 0;
  const g = (x) => x && x.total ? `${x.passed} / ${x.total} passed` : 'not run';
  return {
    run: runFor ? runFor.number : null,
    list: [
      { key: 'unit', label: `Unit tests ${g(s.unit)}`, ok: !!(s.unit && s.unit.total && s.unit.failed === 0) },
      { key: 'integration', label: `Integration ${g(s.integration)}`, ok: !!(s.integration && s.integration.total && s.integration.failed === 0) },
      { key: 'e2e', label: `E2E ${g(s.e2e)}`, ok: !!(s.e2e && s.e2e.total && s.e2e.failed === 0) },
      { key: 'load', label: s.load ? `Load test p95 ${s.load.p95} ms @ ${s.load.users} users (< 800 ms)` : 'Load test not run', ok: !!(s.load && s.load.p95 < 800 && s.load.errorPct < 2) },
      { key: 'bugs', label: blockers ? `${blockers} open Critical / High bug${blockers === 1 ? '' : 's'} for this release` : 'No open Critical / High bugs for this release', ok: blockers === 0 },
      { key: 'manual', label: `Manual regression checklist (${rel ? rel.checklist || 0 : 0} cases)`, ok: !!(rel && rel.checklistDone) },
    ],
  };
}

const ROLES = [
  ['QA', 'QA lead'],
  ['PO', 'Product owner'],
  ['DL', 'Dev lead'],
];

// GET /qa/overview — 4A
async function overview(req, res) {
  if (!guard(req, res)) return;
  const [info, rels, settings] = await Promise.all([serverInfo(), M('LmsRelease').find({}).sort({ created: -1 }).limit(30).lean(), qaSettings()]);
  const live = rels.find((r) => r.env === 'prod') || null;
  const qa = rels.find((r) => r.env === 'qa') || null;
  const dev = rels.find((r) => r.env === 'dev') || null;
  const rc = qa || dev;
  const gg = rc ? await gates(rc) : null;
  const history = [];
  for (const r of rels) for (const h of r.history || []) history.push({ ...h, version: r.version });
  history.sort((a, b) => new Date(b.at) - new Date(a.at));
  return ok(res, {
    server: info,
    envs: { dev, qa, prod: live },
    rc,
    gates: gg,
    signoffRoles: ROLES,
    rollback: rels.filter((r) => r.liveAt).sort((a, b) => new Date(b.liveAt) - new Date(a.liveAt)).slice(0, 6),
    history: history.slice(0, 12),
    settings,
    releases: rels.map((r) => ({ id: String(r._id), version: r.version, env: r.env, status: r.status })),
  });
}

// POST /qa/releases  { version, title, commit, branch, env, checklist }
async function createRelease(req, res) {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const version = str(b.version, 40);
  if (!/^v?\d+\.\d+\.\d+/.test(version)) return bad(res, 400, 'Version like v2.14.0 or v2.14.0-rc.1');
  const info = await serverInfo();
  const env = ['dev', 'qa'].includes(b.env) ? b.env : 'dev';
  try {
    const r = await M('LmsRelease').create({
      version: version.startsWith('v') ? version : `v${version}`,
      title: str(b.title, 200),
      commit: str(b.commit, 40) || info.commit,
      branch: str(b.branch, 60) || info.branch,
      env,
      status: env === 'qa' ? 'in_qa' : 'building',
      checklist: Math.max(0, Math.round(Number(b.checklist) || 0)),
      deployedQaAt: env === 'qa' ? new Date() : undefined,
      history: [{ at: new Date(), env, text: `${version} → ${env === 'qa' ? 'QA' : 'Dev'}`, by: req.admin.name }],
      createdBy: req.admin.name,
    });
    if (env === 'qa') await M('LmsRelease').updateMany({ _id: { $ne: r._id }, env: 'qa' }, { $set: { env: 'superseded', status: 'superseded' } });
    await qaLog.log('INFO', `release ${r.version} created (${env}) by ${req.admin.name}`, { source: 'release' });
    return ok(res, r, 'Release created');
  } catch (e) {
    if (e.code === 11000) return bad(res, 409, 'That version already exists.');
    throw e;
  }
}

async function loadRel(req, res) {
  const r = mongoose.isValidObjectId(req.params.id) ? await M('LmsRelease').findById(req.params.id) : null;
  if (!r) bad(res, 404, 'Release not found.');
  return r;
}

// POST /qa/releases/:id/:action  (to-qa | signoff | send-back | promote | rollback | checklist)
async function releaseAction(req, res) {
  if (!guard(req, res)) return;
  const r = await loadRel(req, res);
  if (!r) return;
  const act = req.params.action;
  const now = new Date();
  const who = req.admin.name;
  const R = M('LmsRelease');
  if (act === 'to-qa') {
    await R.updateMany({ _id: { $ne: r._id }, env: 'qa' }, { $set: { env: 'superseded', status: 'superseded' } });
    r.env = 'qa';
    r.status = 'in_qa';
    r.signoffs = [];
    r.deployedQaAt = now;
    r.history.push({ at: now, env: 'qa', text: `${r.version} → QA`, by: who });
    await r.save();
    runner.start({ by: who, release: r.version, trigger: 'deploy' }).catch(() => {});
    return ok(res, r, 'Moved to QA — automated suites started');
  }
  if (act === 'checklist') {
    r.checklist = Math.max(0, Math.round(Number(req.body.checklist) || r.checklist || 0));
    r.checklistDone = !!req.body.done;
    await r.save();
    return ok(res, r, 'Checklist saved');
  }
  if (act === 'signoff') {
    const role = ROLES.find((x) => x[0] === req.body.role);
    if (!role) return bad(res, 400, 'Pick QA, PO or DL.');
    const decision = req.body.decision === 'reject' ? 'rejected' : 'approved';
    r.signoffs = (r.signoffs || []).filter((s) => s.role !== role[0]);
    r.signoffs.push({ role: role[0], name: `${role[1]} · ${who}`, by: req.admin._id, decision, at: now, note: str(req.body.note, 300) });
    if (ROLES.every(([k]) => r.signoffs.some((s) => s.role === k && s.decision === 'approved'))) r.status = 'signed_off';
    r.history.push({ at: now, env: r.env, text: `${role[1]} ${decision} ${r.version}`, by: who });
    await r.save();
    return ok(res, r, `Sign-off recorded (${decision})`);
  }
  if (act === 'send-back') {
    r.env = 'dev';
    r.status = 'sent_back';
    r.signoffs = [];
    r.history.push({ at: now, env: 'dev', text: `${r.version} sent back to dev${req.body.note ? `: ${str(req.body.note, 200)}` : ''}`, by: who });
    await r.save();
    return ok(res, r, 'Sent back to dev');
  }
  if (act === 'promote') {
    const g = await gates(r);
    const failing = g.list.filter((x) => !x.ok).map((x) => x.label);
    if (failing.length) return bad(res, 409, `Gates not met: ${failing.join(' · ')}`);
    if (!ROLES.every(([k]) => (r.signoffs || []).some((s) => s.role === k && s.decision === 'approved'))) return bad(res, 409, 'All three sign-offs (QA, PO, Dev lead) are needed.');
    await R.updateMany({ _id: { $ne: r._id }, env: 'prod' }, { $set: { env: 'superseded', status: 'superseded' } });
    r.env = 'prod';
    r.status = 'live';
    r.liveAt = now;
    r.history.push({ at: now, env: 'prod', text: `${r.version} → Prod`, by: who });
    await r.save();
    await qaLog.log('INFO', `${r.version} promoted to production by ${who}`, { source: 'release' });
    return ok(res, r, 'Recorded as live — deploy it with the deploy script on the server');
  }
  if (act === 'rollback') {
    const cur = await R.findOne({ env: 'prod' });
    if (cur && String(cur._id) === String(r._id)) return bad(res, 400, 'That is the live release.');
    if (!r.liveAt) return bad(res, 400, 'Only a release that was live before can be rolled back to.');
    if (cur) {
      cur.env = 'rolled_back';
      cur.status = 'rolled_back';
      cur.rolledBackAt = now;
      cur.history.push({ at: now, env: 'prod', text: `${cur.version} → Prod (rolled back)`, by: who });
      await cur.save();
    }
    r.env = 'prod';
    r.status = 'live';
    r.liveAt = now;
    r.history.push({ at: now, env: 'prod', text: `Rolled back to ${r.version}`, by: who });
    await r.save();
    await qaLog.log('WARN', `rolled back production to ${r.version} by ${who}`, { source: 'release' });
    return ok(res, r, `Recorded rollback to ${r.version} — redeploy that version with the deploy script`);
  }
  return bad(res, 400, 'Unknown action.');
}

// PUT /qa/settings  { autoRollback, access, teams }
async function saveSettings(req, res) {
  if (!guard(req, res)) return;
  const cur = await qaSettings();
  const b = req.body || {};
  const next = {
    autoRollback: b.autoRollback === undefined ? cur.autoRollback : !!b.autoRollback,
    access: { ...cur.access, ...(b.access || {}) },
    teams: {
      dev: Array.isArray(b.teams && b.teams.dev) ? b.teams.dev.map((x) => str(x, 60)).filter(Boolean) : cur.teams.dev,
      qa: Array.isArray(b.teams && b.teams.qa) ? b.teams.qa.map((x) => str(x, 60)).filter(Boolean) : cur.teams.qa,
    },
  };
  await M('LmsGrowthConfig').updateOne({ key: 'live' }, { $set: { qa: next } }, { upsert: true });
  return ok(res, next, 'Saved');
}

// ── 4B accounts & seed ──
const QA_RX = /^qa\./i;
// GET /qa/accounts
async function accounts(req, res) {
  if (!guard(req, res)) return;
  const admins = await M('Admin').find({ email: QA_RX, removed: { $ne: true } }).select('name email role enabled').lean();
  const rows = [];
  for (const a of admins) {
    // eslint-disable-next-line no-await-in-loop
    const roster = await M('Student').findOne({ email: A.rxEq(a.email), removed: { $ne: true } }).select('batch').lean();
    let linked = '';
    if (a.role === 'Student') {
      // eslint-disable-next-line no-await-in-loop
      const [p, d] = await Promise.all([M('LmsProjectAllocation').countDocuments({ removed: false, $or: [{ learner: a._id }, { members: a._id }] }), M('LmsActivityDay').findOne({ crmUser: a._id }).sort({ date: -1 }).select('date').lean()]);
      linked = `${roster && roster.batch ? `${roster.batch} batch` : 'no batch'} · ${p} project${p === 1 ? '' : 's'}${d ? ` · active ${d.date}` : ''}`;
    } else if (a.role === 'Teacher') {
      // eslint-disable-next-line no-await-in-loop
      const b = await A.mentorBatches(a);
      // eslint-disable-next-line no-await-in-loop
      const n = (await A.learnersOf(b.map((x) => x.name))).length;
      linked = `${n} assigned learner${n === 1 ? '' : 's'}`;
    } else if (a.role === 'Support') linked = 'Support queues';
    else linked = 'All batches';
    rows.push({ id: String(a._id), name: a.name, email: a.email, role: a.role, enabled: a.enabled !== false, linked });
  }
  const share = await M('LmsShareLink').findOne({ crmUser: { $in: admins.filter((a) => a.role === 'Student').map((a) => a._id) }, revoked: false }).lean();
  const last = await M('LmsQaLog').findOne({ source: 'qa', message: /^QA data reset/ }).sort({ at: -1 }).lean();
  return ok(res, { rows, recruiter: share ? { token: share.token } : null, lastReset: last ? { at: last.at, text: last.message } : null, dbSeparate: (await serverInfo()).dbSeparate, payTest: /^rzp_test/.test(process.env.RAZORPAY_KEY_ID || '') });
}

// POST /qa/accounts  { role, name, email?, password } — creates a qa.* login
async function addAccount(req, res) {
  if (!guard(req, res)) return;
  const role = ['Student', 'Teacher', 'Support', 'Admin'].includes(req.body.role) ? req.body.role : 'Student';
  const name = str(req.body.name, 80) || `QA ${role}`;
  let email = str(req.body.email, 120).toLowerCase() || `qa.${role.toLowerCase()}.${Date.now().toString(36)}@careerlabconsulting.com`;
  if (!QA_RX.test(email)) email = `qa.${email}`;
  const password = str(req.body.password, 80);
  if (password.length < 8) return bad(res, 400, 'Password: at least 8 characters.');
  if (await M('Admin').findOne({ email, removed: { $ne: true } })) return bad(res, 409, 'That email already has a login.');
  const bcrypt = require('bcryptjs');
  const salt = require('shortid').generate();
  const user = await new (M('Admin'))({ name, email, role, enabled: true }).save();
  await new (M('AdminPassword'))({ password: bcrypt.hashSync(salt + password), salt, emailVerified: true, user: user._id }).save();
  await qaLog.log('INFO', `QA account ${email} (${role}) created by ${req.admin.name}`, { source: 'qa' });
  return ok(res, { id: String(user._id), email, role }, 'Test account created — keep the password in the team vault');
}

// POST /qa/reset  { sets:['standard','edge'] } — QA accounts only
async function resetData(req, res) {
  if (!guard(req, res)) return;
  const sets = Array.isArray(req.body.sets) ? req.body.sets : ['standard'];
  const learners = await M('Admin').find({ email: QA_RX, role: 'Student', removed: { $ne: true } }).select('_id name email').lean();
  if (!learners.length) return bad(res, 400, 'No qa.* learner accounts to reset.');
  const ids = learners.map((l) => l._id);
  // wipe only the QA learners' growth data
  await Promise.all([
    M('LmsActivityDay').deleteMany({ crmUser: { $in: ids } }),
    M('LmsContentProgress').deleteMany({ crmUser: { $in: ids } }),
    M('LmsEngagementAlert').deleteMany({ learner: { $in: ids } }),
    M('LmsMentorRemark').deleteMany({ learner: { $in: ids } }),
    M('LmsShareLink').deleteMany({ crmUser: { $in: ids } }),
    M('LmsScoreSnapshot').deleteMany({ crmUser: { $in: ids } }),
    M('LmsProjectAllocation').deleteMany({ $or: [{ learner: { $in: ids } }, { members: { $in: ids } }] }),
  ]);
  const eng = require('../../../../../services/lms/growth/engagement');
  const today = eng.istDate();
  let seeded = 0;
  // deterministic pseudo-random
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (const [li, l] of learners.entries()) {
    const edge = sets.includes('edge') && li === learners.length - 1 && learners.length > 1;
    if (sets.includes('standard')) {
      const docs = [];
      for (let i = 84; i >= 0; i--) {
        const date = eng.addDays(today, -i);
        if (edge && i < 6) continue; // edge: inactive 6 days
        const x = rnd();
        if (x < 0.18) continue;
        const act = Math.round((20 + x * 120) * 60);
        const hours = Array(24).fill(0);
        hours[19] = Math.round(act * 0.6);
        hours[20] = act - hours[19];
        docs.push({
          crmUser: l._id,
          email: l.email,
          date,
          activeSec: act,
          idleSec: Math.round(act * 0.15),
          byKind: { editor: Math.round(act * 0.4), lesson: Math.round(act * 0.27), video: Math.round(act * 0.2), assessment: Math.round(act * 0.13), live: 0, material: 0, other: 0 },
          hours,
          logins: 1 + Math.round(x * 2),
          firstAt: new Date(`${date}T19:00:00+05:30`),
          lastAt: new Date(`${date}T20:40:00+05:30`),
          items: [{ kind: 'lesson', ref: `qa-lesson-${(i % 6) + 1}`, title: `QA seed lesson ${(i % 6) + 1}`, course: 'QA seed course', module: `Module ${Math.floor(i / 14) + 1}`, activeSec: Math.round(act * 0.27) }],
        });
      }
      // eslint-disable-next-line no-await-in-loop
      if (docs.length) await M('LmsActivityDay').insertMany(docs, { ordered: false });
      seeded += docs.length;
      // eslint-disable-next-line no-await-in-loop
      await M('LmsContentProgress').insertMany(
        [1, 2, 3, 4].map((n) => ({ crmUser: l._id, kind: n % 2 ? 'lesson' : 'video', ref: `qa-lesson-${n}`, title: `QA seed lesson ${n}`, course: 'QA seed course', module: 'Module 1', opens: n, activeSec: 300 * n, scrollDepth: n % 2 ? 40 + n * 15 : 0, readPct: n % 2 ? 40 + n * 15 : 0, durationSec: n % 2 ? undefined : 1200, videoPct: n % 2 ? 0 : 30 * n, pauses: n, rewatches: n - 1, completed: n === 3, lastAt: new Date() })),
        { ordered: false }
      );
    }
  }
  await qaLog.log('INFO', `QA data reset (${sets.join(', ')}) by ${req.admin.name} · ${learners.length} QA learner(s), ${seeded} activity days`, { source: 'qa' });
  return ok(res, { learners: learners.length, activityDays: seeded }, `QA data reset — ${learners.length} QA learner(s) re-seeded`);
}

// ── 4C tests ──
// GET /qa/runs
async function runs(req, res) {
  if (!guard(req, res)) return;
  await runner.ensureCases();
  const list = await M('LmsTestRun').find({}).sort({ number: -1 }).limit(12).lean();
  const cases = await M('LmsTestCase').find({ removed: { $ne: true } }).sort({ code: 1 }).lean();
  return ok(res, { running: runner.isRunning(), runs: list.reverse(), latest: list.length ? list[list.length - 1] : null, cases, checks: runner.CHECKS.map((c) => ({ id: c[0], suite: c[1], name: c[2] })) });
}
// POST /qa/runs  { release }
async function startRun(req, res) {
  if (!guard(req, res)) return;
  const live = await M('LmsRelease').findOne({ env: 'qa' }).select('version').lean();
  const r = await runner.start({ by: req.admin.name, release: str(req.body.release, 40) || (live && live.version) || null });
  return ok(res, r, `Run #${r.number} started`);
}
// POST /qa/cases  ·  PUT /qa/cases/:id
async function saveCase(req, res) {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const doc = {
    title: str(b.title, 200),
    module: str(b.module, 60),
    type: ['Unit', 'Integration', 'E2E', 'Load', 'Manual'].includes(b.type) ? b.type : 'Manual',
    priority: ['Critical', 'High', 'Medium', 'Low'].includes(b.priority) ? b.priority : 'Medium',
    steps: str(b.steps, 2000),
    release: str(b.release, 40),
    updated: new Date(),
  };
  if (b.lastResult && ['Passed', 'Failed', 'Flaky', 'Not run'].includes(b.lastResult)) doc.lastResult = b.lastResult;
  if (!doc.title) return bad(res, 400, 'Write the test case.');
  if (req.params.id) {
    const r = await M('LmsTestCase').findByIdAndUpdate(req.params.id, { $set: doc }, { new: true });
    return r ? ok(res, r, 'Saved') : bad(res, 404, 'Not found.');
  }
  const n = await M('LmsTestCase').countDocuments({});
  const r = await M('LmsTestCase').create({ ...doc, code: `TC-${1000 + n + 1}` });
  return ok(res, r, 'Test case added');
}

// ── 4D bugs ──
// GET /qa/bugs?release=
async function bugs(req, res) {
  if (!guard(req, res)) return;
  const rels = await M('LmsRelease').find({}).sort({ created: -1 }).limit(20).lean();
  const release = req.query.release || (rels.find((r) => r.env === 'qa') || rels[0] || {}).version || null;
  const list = await M('LmsBug').find({ removed: false, ...(release ? { release } : {}) }).sort({ updated: -1 }).lean();
  const byRel = await M('LmsBug').aggregate([
    { $match: { removed: false } },
    { $group: { _id: '$release', found: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ['$status', ['open', 'in_progress']] }, 1, 0] } }, ch: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['open', 'in_progress']] }, { $in: ['$severity', ['Critical', 'High']] }] }, 1, 0] } } } },
  ]);
  const team = await M('Admin').find({ role: { $in: ['owner', 'Super Admin', 'Admin'] }, removed: { $ne: true } }).select('name').lean();
  return ok(res, {
    release,
    releases: rels.map((r) => ({ version: r.version, env: r.env, status: r.status })),
    bugs: list,
    byRelease: rels.map((r) => {
      const x = byRel.find((y) => y._id === r.version) || { found: 0, open: 0, ch: 0 };
      return { version: r.version, env: r.env, status: r.status, ...x };
    }),
    team: team.map((t) => ({ id: String(t._id), name: t.name })),
  });
}
// POST /qa/bugs  ·  PUT /qa/bugs/:id  (status moves are logged)
async function saveBug(req, res) {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const B = M('LmsBug');
  if (req.params.id) {
    const bug = await B.findById(req.params.id);
    if (!bug) return bad(res, 404, 'Bug not found.');
    for (const k of ['title', 'description', 'module', 'release', 'fixedIn', 'testCase']) if (b[k] !== undefined) bug[k] = str(b[k], k === 'description' ? 3000 : 200);
    if (b.severity && ['Critical', 'High', 'Medium', 'Low'].includes(b.severity)) bug.severity = b.severity;
    if (b.status && ['open', 'in_progress', 'fixed', 'verified'].includes(b.status) && b.status !== bug.status) {
      bug.history.push({ at: new Date(), by: req.admin.name, from: bug.status, to: b.status });
      bug.status = b.status;
    }
    if (b.assignee !== undefined) {
      const a = b.assignee && mongoose.isValidObjectId(b.assignee) ? await M('Admin').findById(b.assignee).select('name').lean() : null;
      bug.assignee = a ? a._id : undefined;
      bug.assigneeName = a ? a.name : '';
    }
    bug.updated = new Date();
    await bug.save();
    return ok(res, bug, 'Saved');
  }
  const title = str(b.title, 200);
  if (!title) return bad(res, 400, 'Describe the bug.');
  const last = await B.findOne({}).sort({ created: -1 }).select('code').lean();
  const n = last ? Number(String(last.code).replace(/\D/g, '')) + 1 : 401;
  const a = b.assignee && mongoose.isValidObjectId(b.assignee) ? await M('Admin').findById(b.assignee).select('name').lean() : null;
  const bug = await B.create({ code: `BUG-${n}`, title, description: str(b.description, 3000), severity: ['Critical', 'High', 'Medium', 'Low'].includes(b.severity) ? b.severity : 'Medium', module: str(b.module, 60), release: str(b.release, 40), assignee: a ? a._id : undefined, assigneeName: a ? a.name : '', reporterName: req.admin.name });
  await qaLog.log(bug.severity === 'Critical' || bug.severity === 'High' ? 'WARN' : 'INFO', `${bug.code} reported (${bug.severity}) on ${bug.release || 'no release'} · ${title}`, { source: 'qa' });
  return ok(res, bug, `${bug.code} reported`);
}

// ── 4E flags, access, logs ──
async function listFlags(req, res) {
  if (!guard(req, res)) return;
  const [rows, batches] = await Promise.all([flags.all(), M('Batch').find({ removed: { $ne: true } }).select('name').lean()]);
  return ok(res, { flags: rows, batches: batches.map((b) => b.name), isQa: flags.isQa() });
}
async function saveFlag(req, res) {
  if (!guard(req, res)) return;
  const b = req.body || {};
  const F = M('LmsFeatureFlag');
  const set = { updated: new Date(), updatedBy: req.admin.name };
  if (b.description !== undefined) set.description = str(b.description, 200);
  if (b.qa !== undefined) set.qa = !!b.qa;
  if (b.rollout !== undefined) set.rollout = Math.max(0, Math.min(100, Math.round(Number(b.rollout) || 0)));
  if (b.audience !== undefined) set.audience = str(b.audience, 100) || 'all';
  let row;
  if (req.params.id) row = await F.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
  else {
    const key = str(b.key, 60).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!key) return bad(res, 400, 'Give the flag a key (snake_case).');
    try {
      row = await F.create({ key, ...set, qa: b.qa !== false, rollout: set.rollout || 0, audience: set.audience || 'all' });
    } catch (e) {
      if (e.code === 11000) return bad(res, 409, 'That flag already exists.');
      throw e;
    }
  }
  flags.bust();
  await qaLog.log('INFO', `flag ${row.key}: QA ${row.qa ? 'on' : 'off'} · prod ${row.rollout}% · ${row.audience} (by ${req.admin.name})`, { source: 'qa' });
  return ok(res, row, 'Flag saved');
}
// GET /flags/me — every user: which features are on for me
async function myFlags(req, res) {
  return ok(res, await flags.forUser(req.admin));
}

// GET /qa/logs?level=&run=
async function logs(req, res) {
  if (!guard(req, res)) return;
  const L = M('LmsQaLog');
  const lastRun = await M('LmsTestRun').findOne({}).sort({ number: -1 }).select('number').lean();
  const run = req.query.run ? Number(req.query.run) : lastRun ? lastRun.number : null;
  const q = {};
  if (req.query.level && ['INFO', 'WARN', 'ERROR'].includes(req.query.level)) q.level = req.query.level;
  if (req.query.scope === 'run' && run) q.run = run;
  const rows = await L.find(q).sort({ at: -1 }).limit(100).lean();
  const runs = await M('LmsTestRun').find({}).sort({ number: -1 }).limit(10).select('number').lean();
  const perRun = await L.aggregate([{ $match: { level: 'ERROR', run: { $in: runs.map((r) => r.number) } } }, { $group: { _id: '$run', n: { $sum: 1 } } }]);
  const pr = new Map(perRun.map((x) => [x._id, x.n]));
  const top = await L.aggregate([{ $match: { level: 'ERROR', at: { $gte: new Date(Date.now() - 7 * 86400000) } } }, { $group: { _id: '$key', n: { $sum: 1 }, msg: { $last: '$message' } } }, { $sort: { n: -1 } }, { $limit: 5 }]);
  const settings = await qaSettings();
  const team = await M('Admin').find({ role: { $in: ['owner', 'Super Admin', 'Admin'] }, removed: { $ne: true } }).select('name').lean();
  return ok(res, {
    run,
    rows: rows.reverse(),
    perRun: runs.reverse().map((r) => ({ run: r.number, n: pr.get(r.number) || 0 })),
    top: top.map((t) => ({ key: t._id || t.msg, n: t.n })),
    errors24h: await L.countDocuments({ level: 'ERROR', at: { $gte: new Date(Date.now() - 86400000) } }),
    settings,
    people: team.map((t) => t.name),
  });
}

module.exports = { overview, createRelease, releaseAction, saveSettings, accounts, addAccount, resetData, runs, startRun, saveCase, bugs, saveBug, listFlags, saveFlag, myFlags, logs };
