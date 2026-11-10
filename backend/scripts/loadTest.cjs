#!/usr/bin/env node
/*
 * Spec §20 load test — read-only. Fires concurrent GET requests at the
 * running API and reports throughput, p50 / p95 / p99 latency and the error
 * rate, then records the result in Admin & Ops → Evidence (opsReport).
 * No dependencies beyond Node itself.
 *
 *   node scripts/loadTest.cjs --base https://clcone.careerlabconsulting.com --concurrency 50 --requests 2000
 *   LOADTEST_TOKEN=<staff bearer token> node scripts/loadTest.cjs --base ... --paths /api/lms/live-classes,/api/lms/learner/dashboard
 *   node scripts/loadTest.cjs --base http://localhost:8888 --no-report      (just print)
 *
 * Default paths are public / cheap (health + certificate verify). Only GET is
 * ever sent. Pass/fail: error rate < 1% and p95 < 1500 ms (override with
 * --max-p95 / --max-errors). Run it outside class hours on production.
 */
const http = require('http');
const https = require('https');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
}
const has = (name) => process.argv.includes(`--${name}`);

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function hit(url, token) {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'User-Agent': 'clc-loadtest' }, timeout: 15000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: res.statusCode }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0 }));
  });
}

async function run({ base, paths, concurrency, requests, token }) {
  const urls = paths.map((p) => base.replace(/\/$/, '') + p);
  let next = 0;
  const results = [];
  const started = Date.now();
  async function worker() {
    while (next < requests) {
      const url = urls[next % urls.length];
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results.push(await hit(url, token));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
  const secs = (Date.now() - started) / 1000;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  // 4xx on a protected path without a token is still a served request; only
  // 5xx / network failures count as errors
  const errors = results.filter((r) => r.status === 0 || r.status >= 500).length;
  return {
    requests: results.length,
    concurrency,
    rps: Math.round((results.length / secs) * 10) / 10,
    p50: Math.round(pct(lat, 50)),
    p95: Math.round(pct(lat, 95)),
    p99: Math.round(pct(lat, 99)),
    errors,
    errorPct: Math.round((errors / Math.max(1, results.length)) * 1000) / 10,
    seconds: Math.round(secs * 10) / 10,
  };
}

async function main() {
  const base = arg('base', process.env.LOADTEST_BASE);
  if (!base) throw new Error('--base <url> is required');
  const paths = String(arg('paths', '/api/lms/health,/api/certificate-verify/CLC-0000-LOADTEST')).split(',').map((p) => p.trim()).filter(Boolean);
  const r = await run({ base, paths, concurrency: Number(arg('concurrency', 25)), requests: Number(arg('requests', 500)), token: process.env.LOADTEST_TOKEN });
  const maxP95 = Number(arg('max-p95', 1500));
  const maxErr = Number(arg('max-errors', 1));
  const ok = r.errorPct < maxErr && r.p95 < maxP95;
  const summary = `${r.requests} req @ ${r.concurrency} concurrent · ${r.rps} req/s · p50 ${r.p50} / p95 ${r.p95} / p99 ${r.p99} ms · errors ${r.errorPct}%`;
  console.log(`[loadtest] ${ok ? 'PASS' : 'FAIL'} · ${summary}`);
  if (!has('no-report')) await require('./opsReport.cjs').report('loadTest', ok, summary, { base, paths, ...r });
  if (!ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[loadtest] failed:', e.message);
    process.exit(1);
  });
}

module.exports = { run, pct };
