const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');

// Recorded-class transcripts (WhisperLiveKit plan, phase 1 — user ask
// 2026-11-15). Runs faster-whisper (the engine WhisperLiveKit uses) on the
// recording's OWN media file, so every line's time is a second of the video
// the student watches — point-to-point sync with no clock maths.
//
// The VPS has 4 CPUs, no GPU, and also runs BBB + the CRM, so:
//   • one recording at a time, `nice -n 19`, a few threads;
//   • only inside the night window (default 22:15–09:30 IST) — a manager's
//     "Transcribe now" (priority > 0) may run any time;
//   • never while a class is live: a running job is killed the moment one
//     starts and goes back to the queue.
// Off automatically where Whisper isn't installed (the laptop backend, Vercel).

const PYTHON = process.env.WHISPER_PYTHON || '/opt/whisper/venv/bin/python';
const SCRIPT = process.env.WHISPER_SCRIPT || path.resolve(process.cwd(), '..', 'deploy', 'vps', 'whisper', 'transcribe.py');
const MODEL = process.env.TRANSCRIBE_MODEL || 'small';
const THREADS = Number(process.env.TRANSCRIBE_THREADS || 3);
// Writing modes (picked per recording in the transcript panel). Tested on a
// real Hinglish class 2026-11-16: auto-detect picks Hindi and small writes
// garbled Devanagari; forcing 'en' with a Hinglish prompt gives clean Roman
// Hinglish in the teacher's own words, ~8x faster. 'english' = Whisper's
// translate task.
const ROMAN_PROMPT =
  process.env.TRANSCRIBE_PROMPT ||
  'Hello students, aaj hum logistic regression padhenge. Ye supervised classification algorithm hai, theek hai? Chaliye code dekhte hain.';
const MODES = {
  roman: ['--language', 'en', '--prompt', ROMAN_PROMPT],
  english: ['--language', 'hi', '--task', 'translate'],
  hindi: ['--language', 'hi'],
};
const DEFAULT_MODE = MODES[process.env.TRANSCRIBE_MODE] ? process.env.TRANSCRIBE_MODE : 'roman';
const modeOf = (row) => (row && MODES[row.mode] ? row.mode : DEFAULT_MODE);
const WINDOW = process.env.TRANSCRIBE_WINDOW || '22:15-09:30'; // IST (process TZ)
const MAX_ATTEMPTS = 3;
// backoff before the next try of a failed run: 10 min, 20 min, 40 min …
const RETRY_BASE_MS = 10 * 60 * 1000;
// a run that takes longer than this is killed and counted as a failed try
// (a 2-hour class takes well under an hour with `small` on the VPS)
const RUN_TIMEOUT_MS = Number(process.env.TRANSCRIBE_TIMEOUT_MIN || 300) * 60 * 1000;
const BBB_PUBLISHED = process.env.BBB_PUBLISHED_DIR || '/var/bigbluebutton/published/presentation';
const LIVE_STATES = ['starting', 'live', 'ending'];
const HOST = os.hostname();

let child = null; // { proc, id, killedFor }

function enabled() {
  if (process.env.TRANSCRIBE_ENABLED === '0') return false;
  return fs.existsSync(PYTHON) && fs.existsSync(SCRIPT);
}

function inWindow(d = new Date()) {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(WINDOW);
  if (!m) return true;
  const now = d.getHours() * 60 + d.getMinutes();
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = Number(m[3]) * 60 + Number(m[4]);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

async function classIsLive() {
  return !!(await mongoose.model('LmsLiveSession').exists({ removed: { $ne: true }, status: { $in: LIVE_STATES } }));
}

// The file the player plays → its audio is the transcript's timeline.
function mediaFor(rec) {
  if (rec.provider === 'bigbluebutton' && rec.recordingId) {
    const dir = path.join(BBB_PUBLISHED, rec.recordingId, 'video');
    for (const f of ['webcams.webm', 'webcams.mp4']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
  if (rec.provider === 'mock' || rec.provider === 'jitsi') {
    const url = rec.playbackUrl || rec.downloadUrl || '';
    const m = /\/(public\/uploads\/[^?#]+)/.exec(url);
    if (!m) return null;
    const p = path.join(process.cwd(), 'src', decodeURIComponent(m[1]));
    return fs.existsSync(p) ? p : null;
  }
  return null; // 'external' (Drive / YouTube link) — no local file
}

// Whisper output → clean, time-ordered caption lines: no empty text, end
// always after start, no line running past the next one's start (WebVTT
// players drop or stack such cues).
function cleanSegments(raw) {
  const segs = (raw || [])
    .map((x) => ({ s: Math.max(0, Math.round(Number(x.s) || 0)), e: Math.round(Number(x.e) || 0), t: String(x.t || '').replace(/\s+/g, ' ').trim() }))
    .filter((x) => x.t)
    .sort((a, b) => a.s - b.s);
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].e <= segs[i].s) segs[i].e = segs[i].s + 1000;
    const next = segs[i + 1];
    if (next && segs[i].e > next.s && next.s > segs[i].s) segs[i].e = next.s;
  }
  return segs;
}

// temp files never outlive a run (audio is read straight from the media file;
// only the JSON result is written to /tmp)
function cleanupTemp(out) {
  for (const f of [out, `${out}.part`]) fs.unlink(f, () => {});
}

// Every playable recording gets a queue row (once).
async function seedQueue() {
  const LiveRecording = mongoose.model('LiveRecording');
  const T = mongoose.model('LmsTranscript');
  const have = new Set((await T.find({ kind: 'final' }).select('recording').lean()).map((t) => String(t.recording)));
  const recs = await LiveRecording.find({ removed: false, status: 'AVAILABLE', provider: { $in: ['bigbluebutton', 'mock', 'jitsi'] } })
    .select('_id liveSession startedAt created')
    .lean();
  const fresh = recs.filter((r) => !have.has(String(r._id)));
  if (!fresh.length) return 0;
  await T.insertMany(
    fresh.map((r) => ({ recording: r._id, liveSession: r.liveSession, kind: 'final', status: 'queued', recordedAt: r.startedAt || r.created })),
    { ordered: false }
  ).catch(() => {}); // a parallel insert hitting the unique index is fine
  return fresh.length;
}

// stop the running job only if it is this row (its writing mode was changed)
function stopRow(id, reason) {
  if (child && child.id === String(id)) stop(reason);
}

function stop(reason) {
  if (!child) return;
  child.killedFor = reason;
  try {
    child.proc.kill('SIGTERM');
  } catch (_) {
    /* already gone */
  }
}

async function runOne(row) {
  const T = mongoose.model('LmsTranscript');
  const rec = await mongoose.model('LiveRecording').findById(row.recording).select('+playbackUrl +downloadUrl provider recordingId status removed').lean();
  const media = rec && !rec.removed && rec.status === 'AVAILABLE' ? mediaFor(rec) : null;
  if (!media) {
    await T.updateOne({ _id: row._id }, { $set: { status: 'skipped', error: 'No local audio for this recording (external link or file missing).', worker: null, updated: new Date() } });
    return;
  }

  const outDir = path.join(os.tmpdir(), 'lms-transcripts');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${row._id}.json`);
  const mode = modeOf(row);
  const args = ['-n', '19', PYTHON, SCRIPT, media, out, '--model', MODEL, '--threads', String(THREADS), ...MODES[mode]];

  const startedAt = Date.now();
  const proc = spawn('nice', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  child = { proc, id: String(row._id), killedFor: null };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill('SIGTERM');
    } catch (_) {
      /* already gone */
    }
  }, RUN_TIMEOUT_MS);
  let stderr = '';
  let lastSave = 0;
  proc.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  proc.stdout.on('data', (d) => {
    for (const line of d.toString().split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.progress != null && Date.now() - lastSave > 30000) {
          lastSave = Date.now();
          T.updateOne({ _id: row._id }, { $set: { progressSec: j.progress, durationSec: j.duration, updated: new Date() } }).catch(() => {});
        }
      } catch (_) {
        /* not a progress line */
      }
    }
  });

  const code = await new Promise((resolve) => proc.on('close', resolve));
  clearTimeout(timer);
  const killedFor = child && child.killedFor;
  child = null;

  if (killedFor) {
    cleanupTemp(out);
    // a class went live / the night ended — back to the queue, no attempt used
    // (not a row removed meanwhile — its recording was deleted)
    await T.updateOne({ _id: row._id, removed: false }, { $set: { status: 'queued', progressSec: 0, worker: null, error: `paused: ${killedFor}`, updated: new Date() } });
    return;
  }
  if (!timedOut && code === 0 && fs.existsSync(out)) {
    let j = null;
    try {
      j = JSON.parse(fs.readFileSync(out, 'utf8'));
    } catch (_) {
      stderr = 'transcript file was not valid JSON';
    }
    cleanupTemp(out);
    if (j) return saveDone(row, j, mode, startedAt);
  }
  cleanupTemp(out);
  await markFailed(row, timedOut ? `took longer than ${Math.round(RUN_TIMEOUT_MS / 60000)} min — stopped` : stderr.trim().split('\n').pop() || `exit ${code}`);
}

// A run failed: try again later (backoff), or give up after MAX_ATTEMPTS —
// then it is listed for managers / support (Recording ops, transcript queue).
async function markFailed(row, reason) {
  const T = mongoose.model('LmsTranscript');
  const attempts = (row.attempts || 0) + 1;
  const final = attempts >= MAX_ATTEMPTS;
  await T.updateOne(
    { _id: row._id, removed: false },
    {
      $set: {
        status: final ? 'failed' : 'queued',
        attempts,
        error: String(reason || 'failed').slice(0, 500),
        retryAfter: final ? null : new Date(Date.now() + RETRY_BASE_MS * 2 ** (attempts - 1)),
        worker: null,
        updated: new Date(),
      },
    }
  );
  if (final) {
    console.error(`[transcriber] gave up on recording ${row.recording} after ${attempts} tries`);
    try {
      require('../../socket').emitLmsBroadcast('lms:transcript', { recording: String(row.recording), status: 'failed' });
    } catch (_) {
      /* no socket */
    }
  }
}

async function saveDone(row, j, mode, startedAt) {
  const T = mongoose.model('LmsTranscript');
  {
    const segments = cleanSegments(j.segments);
    // the language was switched while this ran → keep this text, but the new one stays queued
    const now = await T.findById(row._id).select('mode').lean();
    const switched = now && modeOf(now) !== mode;
    await T.updateOne(
      { _id: row._id, removed: false },
      {
        $set: {
          status: switched ? 'queued' : 'done',
          segments,
          textMode: mode,
          edited: false,
          wordCount: segments.reduce((n, s) => n + s.t.split(/\s+/).filter(Boolean).length, 0),
          model: j.model,
          language: j.language,
          durationSec: j.duration,
          progressSec: j.duration,
          error: null,
          retryAfter: null,
          attempts: 0,
          processingMs: Date.now() - startedAt,
          worker: null,
          finishedAt: new Date(),
          updated: new Date(),
        },
      }
    );
    try {
      require('../../socket').emitLmsBroadcast('lms:transcript', { recording: String(row.recording), status: 'done' });
    } catch (_) {
      /* no socket */
    }
  }
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    if (!enabled()) return;
    const live = await classIsLive();
    if (child) {
      const row = await mongoose.model('LmsTranscript').findById(child.id).select('priority').lean();
      if (live) stop('a class went live');
      else if (!inWindow() && !(row && row.priority > 0)) stop('night window over');
      return;
    }
    if (live) return;
    await seedQueue();
    const T = mongoose.model('LmsTranscript');
    const filter = { status: 'queued', removed: false, kind: 'final', $or: [{ retryAfter: null }, { retryAfter: { $lte: new Date() } }] };
    if (!inWindow()) filter.priority = { $gt: 0 }; // daytime: only "Transcribe now"
    const row = await T.findOneAndUpdate(
      filter,
      { $set: { status: 'processing', worker: HOST, startedAt: new Date(), progressSec: 0, model: MODEL, updated: new Date() } },
      { sort: { priority: -1, recordedAt: -1 }, new: true }
    ).lean();
    if (!row) return;
    runOne(row).catch(async (e) => {
      child = null;
      // counts as a try — an error that keeps coming back must not loop for ever
      await markFailed(row, e.message).catch(() => {});
    });
  } catch (e) {
    console.error('[transcriber]', e.message);
  } finally {
    busy = false;
  }
}

// Rows this host was running when it stopped (restart / deploy) go back.
async function recoverOnBoot() {
  if (!enabled()) return;
  await mongoose
    .model('LmsTranscript')
    .updateMany({ status: 'processing', worker: HOST }, { $set: { status: 'queued', progressSec: 0, worker: null, updated: new Date() } })
    .catch(() => {});
}

function status() {
  return { enabled: enabled(), running: child ? child.id : null, model: MODEL, mode: DEFAULT_MODE, window: WINDOW, inWindow: inWindow() };
}

module.exports = { cleanSegments, MAX_ATTEMPTS, tick, recoverOnBoot, status, mediaFor, inWindow, enabled, stop, stopRow, MODES, DEFAULT_MODE, modeOf };
