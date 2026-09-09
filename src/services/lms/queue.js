const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');

// Thin helpers over the LmsSyncJob model. Producers call enqueue(); the
// consumer (jobs/lmsSyncTick.js) calls claimDue() / settle().

async function enqueue(kind, payload, { dedupeKey, delayMs = 0 } = {}) {
  const LmsSyncJob = mongoose.model('LmsSyncJob');
  const runAfter = new Date(Date.now() + delayMs);

  if (dedupeKey) {
    // fold into an existing pending job for the same intent
    const existing = await LmsSyncJob.findOneAndUpdate(
      { dedupeKey, status: 'pending' },
      { $set: { payload, runAfter, updated: new Date() } },
      { new: true }
    );
    if (existing) return existing;
  }

  return LmsSyncJob.create({ kind, payload, dedupeKey, runAfter });
}

// Atomically claim one due job (status pending → running). Returns null when
// the queue is empty. One row at a time keeps ordering predictable and avoids
// hammering Moodle from a single-process deployment.
async function claimDue() {
  const LmsSyncJob = mongoose.model('LmsSyncJob');
  return LmsSyncJob.findOneAndUpdate(
    { status: 'pending', runAfter: { $lte: new Date() } },
    { $set: { status: 'running', updated: new Date() }, $inc: { attempts: 1 } },
    { new: true, sort: { runAfter: 1, created: 1 } }
  );
}

async function settle(job, { ok, error, result }) {
  const { maxAttempts } = lmsConfig.sync;
  if (ok) {
    job.status = 'done';
    job.result = result;
    job.lastError = undefined;
  } else if (job.attempts >= maxAttempts) {
    job.status = 'dead';
    job.lastError = String(error && error.message ? error.message : error);
  } else {
    job.status = 'pending';
    job.lastError = String(error && error.message ? error.message : error);
    job.runAfter = new Date(Date.now() + lmsConfig.sync.tickMs * 2 ** job.attempts);
  }
  job.updated = new Date();
  await job.save();
  return job;
}

module.exports = { enqueue, claimDue, settle };
