const http = require('http');
const mongoose = require('mongoose');

// Built-in automated test suites for Figma 4C "Run all suites". They test the
// LMS Additional Requirements code where it runs — read-only against the
// database (no test ever writes learner data):
//   unit        — pure functions (score formulas, levels, timers, VTT, streaks, PDF)
//   integration — services against the real database (score engine, engagement, flags…)
//   e2e         — HTTP calls to this server (public + auth-protected endpoints)
//   load        — concurrent HTTP requests, p95 latency + error rate
// A failed check is retried once; passing on the retry marks it "flaky".

const M = (n) => mongoose.model(n);
const assert = (c, msg) => {
  if (!c) throw new Error(msg || 'assertion failed');
};
const G = (p) => require(`./${p}`);
const PORT = () => Number(process.env.PORT || 8888);

function get(path, { headers = {} } = {}) {
  return new Promise((resolve) => {
    const t = Date.now();
    const req = http.get({ host: '127.0.0.1', port: PORT(), path, headers, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => resolve({ status: res.statusCode, body, ms: Date.now() - t }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message, ms: Date.now() - t }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: 'timeout', ms: Date.now() - t });
    });
  });
}

async function qaLearner() {
  return M('Admin').findOne({ email: /^qa\./i, role: 'Student', removed: { $ne: true } }).select('_id name email').lean();
}

const CHECKS = [
  // ── unit ──
  ['u-weights', 'unit', 'Hire-readiness = weighted sum over components with data', 'Learner 360°', async () => {
    const S = G('score360');
    assert(S.combine({ attendance: 86, assessment: 78, coding: 72, project: 81 }, { attendance: 15, assessment: 30, coding: 30, project: 25 }) === 78.2, 'design example should be 78.2');
    assert(S.combine({ attendance: 80, assessment: null, coding: null, project: null }, { attendance: 15, assessment: 30, coding: 30, project: 25 }) === 80, 'missing components re-normalise');
    assert(S.combine({}, { attendance: 15 }) === null, 'no data → null');
  }],
  ['u-levels', 'unit', 'Readiness levels: ≥80 Job Ready, 60–79 Almost, <60 Needs Improvement', 'Learner 360°', async () => {
    const c = G('config');
    const L = { jobReady: 80, almost: 60 };
    assert(c.levelOf(80, L).key === 'job' && c.levelOf(79.9, L).key === 'almost' && c.levelOf(60, L).key === 'almost' && c.levelOf(59, L).key === 'needs', 'level boundaries');
    assert(c.engagementLevelOf(70, { high: 70, moderate: 40 }).key === 'high' && c.engagementLevelOf(39, { high: 70, moderate: 40 }).key === 'low', 'engagement levels');
  }],
  ['u-streak', 'unit', 'Daily streak counts consecutive days with ≥ 10 active minutes', 'Engagement', async () => {
    const e = G('engagement');
    const t = '2026-11-23';
    const by = { '2026-11-20': 900, '2026-11-21': 700, '2026-11-22': 601, '2026-11-23': 0, '2026-11-15': 3000 };
    const s = e.streakOf(by, t);
    assert(s.current === 3, `current should be 3, got ${s.current}`);
    assert(e.streakOf({ '2026-11-22': 599 }, t).current === 0, '< 10 min is not a streak day');
  }],
  ['u-istdate', 'unit', 'Activity days use the IST calendar date', 'Engagement', async () => {
    const e = G('engagement');
    assert(e.istDate(new Date('2026-11-22T19:00:00Z')) === '2026-11-23', '00:30 IST is the next day');
    assert(e.addDays('2026-02-28', 1) === '2026-03-01', 'addDays crosses months');
  }],
  ['u-deadline', 'unit', 'Deadline: absolute date, or N days after the timer starts', 'Projects', async () => {
    const P = G('projects');
    const start = new Date('2026-11-20T04:30:00Z');
    assert(P.deadlineFor({ deadline: new Date('2026-11-25T18:29:00Z') }, start).toISOString() === '2026-11-25T18:29:00.000Z', 'absolute deadline');
    assert(P.deadlineFor({ durationDays: 5, timerStart: 'startDate' }, start) - start === 5 * 86400000, 'duration days');
  }],
  ['u-vtt', 'unit', 'Captions: WebVTT is escaped, time-ordered, end after start', 'Recordings', async () => {
    const { toVtt } = require('../../../controllers/appControllers/lms/lmsController/transcripts');
    const v = toVtt([{ s: 3000, e: 2000, t: 'a <b> & c' }, { s: 0, e: 1500, t: 'first' }]);
    assert(v.startsWith('WEBVTT'), 'header');
    assert(v.indexOf('first') < v.indexOf('a &lt;b&gt; &amp; c'), 'ordered + escaped');
    assert(v.includes('00:00:03.000 --> 00:00:04.000'), 'end fixed after start');
  }],
  ['u-segments', 'unit', 'Transcript segments are cleaned before saving', 'Recordings', async () => {
    const t = require('../transcriber');
    const s = t.cleanSegments([{ s: 5000, e: 4000, t: ' x ' }, { s: 1000, e: 9000, t: 'y' }, { s: 2000, e: 3000, t: '  ' }]);
    assert(s.length === 2 && s[0].t === 'y' && s[0].e === 5000 && s[1].e === 6000, JSON.stringify(s));
  }],
  ['u-pdf', 'unit', '360° PDF renders a 2-page A4 document', 'Learner 360°', async () => {
    const buf = await G('pdf360').render(
      {
        learner: { name: 'QA Test', course: 'Course', batch: 'B', mentor: 'M', learnerId: 'QA-1' },
        total: 78.2,
        level: { tone: 'wa', label: 'Almost Ready' },
        weights: { attendance: 15, assessment: 30, coding: 30, project: 25 },
        scores: { attendance: 86, assessment: 78, coding: 72, project: 81 },
        batchAvg: { attendance: 79, assessment: 66, coding: 64, project: 70, total: 66 },
        history: { weeks: ['a', 'b'], you: [60, 78], batch: [55, 66] },
        radar: { axes: ['Python', 'SQL', 'ML'], you: [80, 70, 60] },
        insights: { strengths: ['x'], improve: ['y'] },
        remarks: [],
        projects: [],
        engagement: null,
        badges: [],
      },
      { verifyUrl: 'https://example.test/verify-360/x' }
    );
    const head = buf.slice(0, 5).toString();
    assert(head === '%PDF-', 'PDF header');
    assert((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length === 2, '2 pages');
  }],
  // ── integration ──
  ['i-models', 'integration', 'All 16 new LMS models are registered on the LMS database', 'Platform', async () => {
    const names = ['LmsGrowthConfig', 'LmsLearnerProfile', 'LmsMentorRemark', 'LmsShareLink', 'LmsScoreSnapshot', 'LmsProjectBrief', 'LmsProjectAllocation', 'LmsActivityDay', 'LmsContentProgress', 'LmsEngagementAlert', 'LmsRelease', 'LmsTestCase', 'LmsTestRun', 'LmsBug', 'LmsFeatureFlag', 'LmsQaLog'];
    const { DB_MAP } = require('../../../config/multiDb');
    for (const n of names) {
      assert(DB_MAP[n] === 'lmsDb', `${n} missing from DB_MAP`);
      await M(n).countDocuments({}).limit(1);
    }
  }],
  ['i-config', 'integration', 'Scoring & engagement settings load with defaults', 'Learner 360°', async () => {
    const c = await G('config').get();
    const w = c.weights;
    assert(w.attendance + w.assessment + w.coding + w.project === 100, 'weights total 100');
    const ew = c.engagement.weights;
    assert(ew.practiceTime + ew.completion + ew.exercises + ew.streak === 100, 'engagement weights total 100');
  }],
  ['i-score', 'integration', 'Score engine computes a real learner (QA account)', 'Learner 360°', async () => {
    const l = await qaLearner();
    assert(l, 'no qa.* learner account');
    const r = await G('score360').compute(l._id, { light: true });
    assert(r && typeof r.scores === 'object', 'no result');
    assert(r.total == null || (r.total >= 0 && r.total <= 100), 'total out of range');
  }],
  ['i-engagement', 'integration', 'Engagement summary computes (score 0–100, 182-day heatmap)', 'Engagement', async () => {
    const l = await qaLearner();
    const s = await G('engagement').summary({ crmUser: l._id, name: l.name, batch: null });
    assert(s.heat.length === 182, 'heatmap length');
    assert(s.score == null || (s.score >= 0 && s.score <= 100), 'score range');
  }],
  ['i-standing', 'integration', 'Batch rank & percentile are consistent', 'Learner 360°', async () => {
    const S = G('score360');
    const row = await M('LmsScoreSnapshot').findOne({ batch: { $ne: null }, total: { $ne: null } }).select('batch').lean();
    if (!row) return;
    const st = await S.batchStanding(row.batch);
    const ranked = st.rows.filter((r) => r.rank);
    for (let i = 1; i < ranked.length; i++) assert(ranked[i - 1].total >= ranked[i].total, 'ranks sorted by score');
    assert(ranked.every((r) => r.percentile >= 0 && r.percentile <= 100), 'percentile range');
  }],
  ['i-skill', 'integration', 'Skill levels for allocation come from real scores', 'Projects', async () => {
    const l = await qaLearner();
    const m = await G('projects').skillLevels([l._id]);
    const s = m.get(String(l._id));
    assert(!s || [null, 'beginner', 'intermediate', 'advanced'].includes(s.level), 'level value');
  }],
  ['i-disq', 'integration', 'No open project is past its deadline un-handled for > 5 min', 'Projects', async () => {
    const late = await M('LmsProjectAllocation').countDocuments({ removed: false, status: { $in: ['allocated', 'in_progress'] }, deadline: { $lt: new Date(Date.now() - 5 * 60000) }, submittedAt: null, allowLate: { $ne: true }, 'extension.status': { $ne: 'pending' } });
    assert(late === 0, `${late} allocation(s) past deadline still open — is the growth job running here?`);
  }],
  ['i-flags', 'integration', 'Feature flags evaluate (rollout %, audience)', 'Platform', async () => {
    const f = G('flags');
    assert(f.bucket('user-1', 'x') >= 0 && f.bucket('user-1', 'x') < 100, 'bucket range');
    assert(f.bucket('user-1', 'x') === f.bucket('user-1', 'x'), 'stable bucket');
    await f.forUser({ _id: 'x', role: 'Student' });
  }],
  ['i-alerts', 'integration', 'Alert rules can list the active learners', 'Engagement', async () => {
    const list = await G('alerts').activeLearners();
    assert(Array.isArray(list), 'list');
  }],
  // ── e2e (HTTP) ──
  ['e-auth', 'e2e', 'Growth API refuses requests without a login', 'Security', async () => {
    for (const p of ['/api/lms/growth/360/me', '/api/lms/growth/config', '/api/lms/growth/projects/dashboard', '/api/lms/growth/qa/overview']) {
      const r = await get(p);
      assert(r.status === 401 || r.status === 403, `${p} returned ${r.status}`);
    }
  }],
  ['e-share-404', 'e2e', 'An unknown / revoked recruiter link shows "no longer active"', 'Learner 360°', async () => {
    const r = await get('/api/lms-public/profile/does-not-exist-xyz');
    assert(r.status === 404 && /no longer active/i.test(r.body), `got ${r.status}`);
  }],
  ['e-share-contact', 'e2e', 'Recruiter link hides contact when the learner turned it off', 'Learner 360°', async () => {
    const link = await M('LmsShareLink').findOne({ revoked: false, 'show.contact': false, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }).lean();
    if (!link) return;
    const r = await get(`/api/lms-public/profile/${link.token}`);
    assert(r.status === 200, `status ${r.status}`);
    const j = JSON.parse(r.body);
    assert(j.result.learner.email == null && j.result.learner.phone == null, 'contact leaked');
    // the probe itself must not count as a recruiter view
    await M('LmsShareLink').updateOne({ _id: link._id }, { $set: { views: link.views, lastViewedAt: link.lastViewedAt } });
  }],
  ['e-verify', 'e2e', 'A tampered 360° PDF code fails verification', 'Learner 360°', async () => {
    const r = await get('/api/lms-public/verify-360/abc.def');
    assert(r.status === 404, `status ${r.status}`);
  }],
];

async function runCheck(c) {
  const t = Date.now();
  try {
    await c[4]();
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: String(e.message || e).slice(0, 300) };
  }
}

async function load(users = 50, perUser = 4) {
  const t = Date.now();
  const lat = [];
  let errors = 0;
  await Promise.all(
    Array.from({ length: users }, async () => {
      for (let i = 0; i < perUser; i++) {
        // eslint-disable-next-line no-await-in-loop
        const r = await get('/api/lms-public/verify-360/load.test');
        lat.push(r.ms);
        if (r.status !== 404) errors += 1;
      }
    })
  );
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] || 0;
  return { users, requests: lat.length, p95, errorPct: lat.length ? Math.round((errors / lat.length) * 1000) / 10 : 0, ms: Date.now() - t };
}

let running = null;

// make sure every automated check has a test case (TC-1xxx)
async function ensureCases() {
  const TC = M('LmsTestCase');
  const have = new Set((await TC.find({ check: { $ne: null } }).select('check').lean()).map((x) => x.check));
  let n = await TC.countDocuments({});
  for (const c of CHECKS) {
    if (have.has(c[0])) continue;
    n += 1;
    // eslint-disable-next-line no-await-in-loop
    await TC.create({ code: `TC-${1000 + n}`, title: c[2], module: c[3], type: c[1] === 'unit' ? 'Unit' : c[1] === 'integration' ? 'Integration' : 'E2E', priority: /Security|Projects/.test(c[3]) ? 'High' : 'Medium', check: c[0] }).catch(() => {});
  }
}

async function start({ by, release, trigger = 'manual' } = {}) {
  if (running) return running;
  const R = M('LmsTestRun');
  const last = await R.findOne({}).sort({ number: -1 }).select('number').lean();
  const number = (last ? last.number : 0) + 1;
  const run = await R.create({ number, by, release, trigger, status: 'running' });
  const log = G('qaLog').log;
  running = { number };
  setImmediate(async () => {
    const t0 = Date.now();
    try {
      await ensureCases();
      await log('INFO', `run #${number} started${release ? ` · ${release}` : ''} · by ${by || 'system'}`, { source: 'test-run', run: number });
      const results = [];
      const suites = {};
      for (const suite of ['unit', 'integration', 'e2e']) {
        const ts = Date.now();
        const list = CHECKS.filter((c) => c[1] === suite);
        let passed = 0;
        let flaky = 0;
        for (const c of list) {
          // eslint-disable-next-line no-await-in-loop
          let r = await runCheck(c);
          let fl = false;
          if (!r.ok) {
            // eslint-disable-next-line no-await-in-loop
            const again = await runCheck(c);
            if (again.ok) {
              fl = true;
              r = again;
              // eslint-disable-next-line no-await-in-loop
              await log('WARN', `${c[0]} flaky — retried, passed on attempt 2`, { source: 'test-run', run: number });
            } else {
              // eslint-disable-next-line no-await-in-loop
              await log('ERROR', `${c[0]} failed · ${r.error}`, { source: 'test-run', run: number, key: c[0] });
            }
          }
          if (r.ok) passed += 1;
          if (fl) flaky += 1;
          results.push({ id: c[0], suite, name: c[2], ok: r.ok, flaky: fl, ms: r.ms, error: r.error });
          // eslint-disable-next-line no-await-in-loop
          await M('LmsTestCase').updateOne({ check: c[0] }, { $set: { lastResult: !r.ok ? 'Failed' : fl ? 'Flaky' : 'Passed', lastRun: number, release, updated: new Date() } });
        }
        suites[suite] = { total: list.length, passed, failed: list.length - passed, flaky, ms: Date.now() - ts };
      }
      suites.load = await load();
      await log(suites.load.errorPct > 1 ? 'WARN' : 'INFO', `load: ${suites.load.requests} requests · ${suites.load.users} users · p95 ${suites.load.p95} ms · ${suites.load.errorPct}% errors`, { source: 'test-run', run: number });
      const total = results.length;
      const passed = results.filter((r) => r.ok).length;
      const linked = await M('LmsTestCase').countDocuments({ check: { $in: CHECKS.map((c) => c[0]) }, removed: { $ne: true } });
      await R.updateOne({ _id: run._id }, { $set: { status: 'done', finishedAt: new Date(), durationMs: Date.now() - t0, suites, results, coverage: Math.round((linked / CHECKS.length) * 1000) / 10 } });
      await log(passed === total ? 'INFO' : 'ERROR', `run #${number} finished · ${passed} / ${total} passed`, { source: 'test-run', run: number });
    } catch (e) {
      await R.updateOne({ _id: run._id }, { $set: { status: 'failed', finishedAt: new Date(), durationMs: Date.now() - t0 } });
      await log('ERROR', `run #${number} crashed · ${e.message}`, { source: 'test-run', run: number });
    } finally {
      running = null;
    }
  });
  return { number };
}

module.exports = { start, CHECKS, isRunning: () => !!running, ensureCases };
