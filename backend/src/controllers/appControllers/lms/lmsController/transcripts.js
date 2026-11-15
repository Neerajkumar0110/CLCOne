const mongoose = require('mongoose');
const { recordingAccess } = require('./liveScope');

// Class transcripts (phase 1: recorded videos) — services/lms/transcriber.js
// writes them; these endpoints read / correct / download them. Access is the
// recording's own access (recordingAccess): whoever may watch it may read it;
// its teacher or a manager may correct lines.

const T = () => mongoose.model('LmsTranscript');

async function loadRec(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ success: false, message: 'Bad recording id.' });
    return null;
  }
  const rec = await mongoose.model('LiveRecording').findById(req.params.id).lean();
  if (!rec || rec.removed) {
    res.status(404).json({ success: false, message: 'Recording not found.' });
    return null;
  }
  const access = await recordingAccess(req.admin, rec);
  if (!access.ok) {
    res.status(access.code).json({ success: false, message: access.message });
    return null;
  }
  return { rec, access };
}

const ms2 = (ms, sep = '.') => {
  const t = Math.max(0, Math.round(ms));
  const h = String(Math.floor(t / 3600000)).padStart(2, '0');
  const m = String(Math.floor((t % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((t % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s}${sep}${String(t % 1000).padStart(3, '0')}`;
};

function toVtt(segments) {
  return `WEBVTT\n\n${segments.map((s, i) => `${i + 1}\n${ms2(s.s)} --> ${ms2(s.e)}\n${s.t}\n`).join('\n')}`;
}

function publicRow(t, access) {
  if (!t) return { status: 'none', segments: [] };
  return {
    id: t._id,
    status: t.status,
    model: t.model,
    language: t.language,
    durationSec: t.durationSec,
    progressSec: t.progressSec,
    wordCount: t.wordCount,
    edited: t.edited,
    editedAt: t.editedAt,
    finishedAt: t.finishedAt,
    error: access.staff ? t.error : undefined,
    segments: t.status === 'done' ? t.segments : [],
    canEdit: !!access.staff,
  };
}

// GET /api/lms/recordings/:id/transcript
async function getTranscript(req, res) {
  const ctx = await loadRec(req, res);
  if (!ctx) return;
  const t = await T().findOne({ recording: ctx.rec._id, kind: 'final', removed: false }).lean();
  let queueAhead;
  if (t && t.status === 'queued') {
    queueAhead = await T().countDocuments({
      status: 'queued',
      removed: false,
      $or: [{ priority: { $gt: t.priority || 0 } }, { priority: t.priority || 0, recordedAt: { $gt: t.recordedAt || new Date(0) } }],
    });
  }
  return res.status(200).json({ success: true, result: { ...publicRow(t, ctx.access), queueAhead } });
}

// GET /api/lms/recordings/:id/transcript.vtt | .txt
async function downloadTranscript(req, res) {
  const ctx = await loadRec(req, res);
  if (!ctx) return;
  const t = await T().findOne({ recording: ctx.rec._id, kind: 'final', removed: false, status: 'done' }).lean();
  if (!t) return res.status(404).json({ success: false, message: 'Transcript not ready yet.' });
  const base = String(ctx.rec.className || ctx.rec.batchName || 'class').replace(/[^\w\- ]+/g, '').trim() || 'class';
  if (req.params.format === 'vtt') {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.vtt"`);
    return res.send(toVtt(t.segments));
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${base} transcript.txt"`);
  return res.send(t.segments.map((s) => `[${ms2(s.s).slice(0, 8)}] ${s.t}`).join('\n'));
}

// PATCH /api/lms/recordings/:id/transcript   { index, text }  — teacher / manager
async function editTranscriptLine(req, res) {
  const ctx = await loadRec(req, res);
  if (!ctx) return;
  if (!ctx.access.staff) return res.status(403).json({ success: false, message: 'Only the class teacher or a manager can correct the transcript.' });
  const index = Number(req.body && req.body.index);
  const text = String((req.body && req.body.text) || '').trim().slice(0, 2000);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ success: false, message: 'Bad line.' });
  const t = await T().findOne({ recording: ctx.rec._id, kind: 'final', status: 'done' }).select('segments').lean();
  if (!t || !t.segments[index]) return res.status(404).json({ success: false, message: 'Line not found.' });
  await T().updateOne(
    { _id: t._id },
    { $set: { [`segments.${index}.t`]: text, edited: true, editedBy: req.admin._id, editedAt: new Date(), updated: new Date() } }
  );
  return res.status(200).json({ success: true, result: { index, text }, message: 'Saved' });
}

// POST /api/lms/recordings/:id/transcript   — manager / teacher: "Transcribe now"
// (jumps the queue; may run in the daytime, still never during a live class)
async function requestTranscript(req, res) {
  const ctx = await loadRec(req, res);
  if (!ctx) return;
  if (!ctx.access.staff) return res.status(403).json({ success: false, message: 'Only the class teacher or a manager can do this.' });
  if (ctx.rec.status !== 'AVAILABLE') return res.status(409).json({ success: false, message: 'The recording is not ready yet.' });
  const existing = await T().findOne({ recording: ctx.rec._id, kind: 'final' }).lean();
  if (existing && existing.status === 'processing') return res.status(200).json({ success: true, result: publicRow(existing, ctx.access), message: 'Already being transcribed.' });
  const t = await T().findOneAndUpdate(
    { recording: ctx.rec._id, kind: 'final' },
    {
      $set: { status: 'queued', priority: 10, attempts: 0, error: null, removed: false, requestedBy: req.admin._id, updated: new Date() },
      $setOnInsert: { liveSession: ctx.rec.liveSession, recordedAt: ctx.rec.startedAt || ctx.rec.created },
    },
    { upsert: true, new: true }
  ).lean();
  setImmediate(() => require('../../../../services/lms/transcriber').tick().catch(() => {}));
  return res.status(200).json({ success: true, result: publicRow(t, ctx.access), message: 'Queued first — it starts within a couple of minutes (never during a live class).' });
}

// GET /api/lms/transcripts/status  — manager: queue overview
async function transcriptQueue(req, res) {
  const { LMS_FULL_ACCESS_ROLES } = require('../../../../config/roles');
  if (!LMS_FULL_ACCESS_ROLES.includes(req.admin.role)) return res.status(403).json({ success: false, message: 'Managers only.' });
  const rows = await T().aggregate([{ $match: { removed: false, kind: 'final' } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const counts = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const running = await T().findOne({ status: 'processing' }).select('recording progressSec durationSec startedAt model').lean();
  return res.status(200).json({ success: true, result: { counts, running, worker: require('../../../../services/lms/transcriber').status() } });
}

module.exports = { getTranscript, downloadTranscript, editTranscriptLine, requestTranscript, transcriptQueue, toVtt };
