const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const google = require('../../../../utils/googleAdsClient');
const drive = require('../../../../services/lms/driveFolder');
const { compressVideo } = require('../../../../services/lms/recordingCompress');
const { lmsConfig } = require('../../../../services/lms');
const { enqueueCompression, RECORDING_STUDENT_DELAY_MS } = require('./liveScope');

// Recordings → "Import from Drive" (managers). Paste a Drive folder link and
// pick a batch: every video in the folder is matched to that batch's class
// by the date in its file name, shown for review, and the ticked ones are
// downloaded, compressed and published to their class on the server — one
// at a time, on the same ffmpeg queue as a manual upload.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istKey = (d) => new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const crmBase = () => lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');

// ── connection ──────────────────────────────────────────────────────────

async function status(req, res) {
  const conn = await drive.getConnection();
  return res.status(200).json({
    success: true,
    result: {
      configured: drive.isConfigured(),
      connected: !!conn,
      email: conn ? conn.googleUserEmail : null,
      connectedBy: conn ? conn.connectedBy : null,
      lastError: conn ? conn.lastError || null : null,
    },
  });
}

async function connect(req, res) {
  if (!drive.isConfigured()) {
    return res.status(400).json({ success: false, message: 'Google sign-in is not configured on the server (GOOGLE_ADS_CLIENT_ID / SECRET / REDIRECT_URI).' });
  }
  const state = jwt.sign({ adminId: req.admin._id, adminName: req.admin.name, purpose: 'google-drive' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const url = google.buildOAuthDialogUrl({ redirectUri: drive.redirectUri(), state, scope: drive.SCOPE });
  return res.status(200).json({ success: true, result: { url } });
}

async function disconnect(req, res) {
  await mongoose.model('LmsDriveConnection').updateMany({ removed: false }, { $set: { removed: true, updated: new Date() } });
  return res.status(200).json({ success: true, result: { connected: false } });
}

// ── scan ────────────────────────────────────────────────────────────────

async function loadBatch(batchId) {
  if (!mongoose.isValidObjectId(batchId)) return null;
  return mongoose.model('Batch').findOne({ _id: batchId, removed: false }).select('name').lean();
}

async function batchSessions(batchId) {
  return mongoose
    .model('LmsLiveSession')
    .find({ batch: batchId, removed: false, status: { $ne: 'cancelled' } })
    .select('title scheduledStart actualStart actualEnd scheduledDurationMin status')
    .sort({ scheduledStart: 1 })
    .lean();
}

// POST /api/lms/admin/drive/scan   { batchId, folderUrl }
async function scan(req, res) {
  const { batchId, folderUrl } = req.body || {};
  const batch = await loadBatch(batchId);
  if (!batch) return res.status(400).json({ success: false, message: 'Pick a batch.' });
  const folderId = drive.extractFolderId(folderUrl);
  if (!folderId) return res.status(400).json({ success: false, message: 'Paste a Google Drive folder link (…/drive/folders/…).' });

  let listing;
  try {
    listing = await drive.listFolderVideos(folderId);
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }

  const now = Date.now();
  const sessions = await batchSessions(batch._id);
  const recs = await mongoose
    .model('LiveRecording')
    .find({ liveSession: { $in: sessions.map((s) => s._id) }, removed: false })
    .select('+playbackUrl liveSession status provider driveFileId')
    .lean();
  const recBySession = new Map(recs.map((r) => [String(r.liveSession), r]));
  const recState = (r) => {
    if (!r) return null;
    const hasVideo = !!r.playbackUrl && r.provider !== 'external';
    return { id: String(r._id), status: r.status, hasVideo: r.status === 'AVAILABLE' && hasVideo, driveFileId: r.driveFileId || null };
  };
  const byDate = new Map();
  sessions.forEach((s) => {
    if (!s.scheduledStart) return;
    const k = istKey(s.scheduledStart);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(s);
  });

  const claimed = new Set();
  const files = listing.files
    .map((f) => ({ ...f, dateKey: drive.dateKeyFromName(f.name) }))
    .sort((a, b) => (a.dateKey || '9999').localeCompare(b.dateKey || '9999') || a.name.localeCompare(b.name));

  const rows = files.map((f) => {
    const row = { ...f, sessionId: null, state: 'no_date' };
    if (!f.dateKey) return row;
    const sameDay = byDate.get(f.dateKey) || [];
    if (!sameDay.length) return { ...row, state: 'no_class' };
    // several files for one day (e.g. 720p + 1440p) → the first one takes
    // the class, the rest are flagged so they can be re-pointed by hand
    const free = sameDay.find((s) => !claimed.has(String(s._id)));
    if (!free) return { ...row, sessionId: String(sameDay[0]._id), state: 'duplicate' };
    claimed.add(String(free._id));
    const rec = recState(recBySession.get(String(free._id)));
    let state = 'ready';
    if (new Date(free.scheduledStart).getTime() > now) state = 'future';
    else if (rec && rec.driveFileId === f.fileId && rec.status === 'AVAILABLE') state = 'imported';
    else if (rec && rec.status === 'PROCESSING') state = 'processing';
    else if (rec && rec.hasVideo) state = 'has_video';
    return { ...row, sessionId: String(free._id), state, recording: rec };
  });

  return res.status(200).json({
    success: true,
    result: {
      folder: listing.folder,
      via: listing.via,
      batch: { id: String(batch._id), name: batch.name },
      files: rows,
      // for re-pointing a file to another class by hand
      sessions: sessions.map((s) => {
        const rec = recState(recBySession.get(String(s._id)));
        return {
          id: String(s._id),
          title: s.title,
          date: s.scheduledStart,
          dateKey: s.scheduledStart ? istKey(s.scheduledStart) : null,
          past: s.scheduledStart ? new Date(s.scheduledStart).getTime() <= now : false,
          recordingStatus: rec ? rec.status : null,
          hasVideo: rec ? rec.hasVideo : false,
        };
      }),
    },
  });
}

// ── import ──────────────────────────────────────────────────────────────

// POST /api/lms/admin/drive/import   { batchId, items: [{ fileId, name, sessionId, durationSec }] }
async function importFiles(req, res) {
  const { batchId, items } = req.body || {};
  const batch = await loadBatch(batchId);
  if (!batch) return res.status(400).json({ success: false, message: 'Pick a batch.' });
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.fileId && i.sessionId);
  if (!list.length) return res.status(400).json({ success: false, message: 'Tick at least one video to import.' });
  const seenSessions = new Set();
  for (const i of list) {
    if (seenSessions.has(String(i.sessionId))) {
      return res.status(400).json({ success: false, message: 'Two videos point to the same class — keep only one per class.' });
    }
    seenSessions.add(String(i.sessionId));
  }

  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const sessions = await LmsLiveSession.find({ _id: { $in: list.map((i) => i.sessionId) }, batch: batch._id, removed: false }).lean();
  const sById = new Map(sessions.map((s) => [String(s._id), s]));

  const queued = [];
  const skipped = [];
  for (const i of list) {
    const s = sById.get(String(i.sessionId));
    if (!s) {
      skipped.push({ fileId: i.fileId, message: 'Class not found in this batch.' });
      continue;
    }
    const existing = await LiveRecording.findOne({ liveSession: s._id, removed: false }).select('status').lean();
    if (existing && existing.status === 'PROCESSING') {
      skipped.push({ fileId: i.fileId, message: 'This class is already processing a video.' });
      continue;
    }
    const now = new Date();
    const start = s.actualStart || s.scheduledStart;
    const durationMin = Number(i.durationSec) > 0 ? Math.max(1, Math.round(Number(i.durationSec) / 60)) : s.scheduledDurationMin || 0;
    const end = s.actualEnd || s.scheduledEnd || (start ? new Date(new Date(start).getTime() + (s.scheduledDurationMin || 60) * 60000) : undefined);
    const rec = await LiveRecording.findOneAndUpdate(
      { liveSession: s._id, removed: false },
      {
        $set: {
          liveClass: s.liveClass,
          crmCourse: s.crmCourse,
          batch: s.batch,
          teacherCrmUser: s.teacherCrmUser,
          courseTitle: s.courseTitle,
          batchName: s.batchName,
          teacherName: s.teacherName,
          className: s.title,
          provider: 'mock',
          status: 'PROCESSING',
          startedAt: start,
          endedAt: end,
          durationMin,
          driveFileId: String(i.fileId),
          driveFileName: String(i.name || '').slice(0, 300),
          updated: now,
        },
        $unset: { failReason: 1 },
        $setOnInsert: { liveSession: s._id, created: now },
      },
      { upsert: true, new: true }
    );
    await LmsLiveSession.updateOne({ _id: s._id }, { $set: { recordingStatus: 'PROCESSING', status: 'recording_processing', updated: now } });
    enqueueCompression(() => runJob(rec._id));
    queued.push({ fileId: i.fileId, recordingId: String(rec._id) });
  }

  return res.status(200).json({
    success: true,
    result: {
      queued: queued.length,
      skipped,
      message: queued.length
        ? `${queued.length} video${queued.length > 1 ? 's' : ''} queued — the server downloads and compresses them one at a time.`
        : 'Nothing was queued.',
    },
  });
}

// GET /api/lms/admin/drive/progress?batchId=
async function progress(req, res) {
  const batch = await loadBatch(req.query.batchId);
  if (!batch) return res.status(400).json({ success: false, message: 'Pick a batch.' });
  const rows = await mongoose
    .model('LiveRecording')
    .find({ batch: batch._id, removed: false, driveFileId: { $exists: true, $ne: null } })
    .select('driveFileId status failReason liveSession')
    .lean();
  return res.status(200).json({
    success: true,
    result: rows.map((r) => ({ fileId: r.driveFileId, recordingId: String(r._id), sessionId: String(r.liveSession), status: r.status, failReason: r.failReason || null })),
  });
}

// ── the queued job ──────────────────────────────────────────────────────

async function runJob(recId) {
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const rec = await LiveRecording.findById(recId).select('liveSession driveFileId status').lean();
  if (!rec || rec.status !== 'PROCESSING' || !rec.driveFileId) return;
  const dir = path.join(process.cwd(), 'src', 'public', 'uploads', 'recordings');
  await fs.promises.mkdir(dir, { recursive: true });
  const rawAbs = path.join(dir, `${rec._id}-drive-raw.mp4`);
  const webRel = `public/uploads/recordings/${rec._id}-web.mp4`;
  const webAbs = path.join(process.cwd(), 'src', webRel);
  try {
    await drive.downloadTo(rec.driveFileId, rawAbs);
    await compressVideo(rawAbs, webAbs);
    fs.unlink(rawAbs, () => {});
    let sizeBytes;
    try {
      sizeBytes = (await fs.promises.stat(webAbs)).size;
    } catch (e) { /* no size shown */ }
    const session = await LmsLiveSession.findById(rec.liveSession).select('actualEnd').lean();
    const earliest = session && session.actualEnd ? new Date(new Date(session.actualEnd).getTime() + RECORDING_STUDENT_DELAY_MS) : new Date();
    const doneAt = new Date();
    const url = `${crmBase()}/${webRel}`;
    await LiveRecording.updateOne(
      { _id: rec._id },
      { $set: { status: 'AVAILABLE', provider: 'mock', playbackUrl: url, downloadUrl: url, publishedAt: earliest > doneAt ? earliest : doneAt, updated: doneAt, ...(sizeBytes !== undefined ? { sizeBytes } : {}) } }
    );
    await LmsLiveSession.updateOne({ _id: rec.liveSession }, { $set: { recordingStatus: 'AVAILABLE', status: 'recording_available', updated: doneAt } });
  } catch (e) {
    fs.unlink(rawAbs, () => {});
    console.error('[lms] Drive folder import failed for recording', String(rec._id), ':', e && e.message);
    await LiveRecording.updateOne({ _id: rec._id }, { $set: { status: 'FAILED', failReason: String(e && e.message).slice(0, 300), updated: new Date() } });
    await LmsLiveSession.updateOne({ _id: rec.liveSession }, { $set: { recordingStatus: 'FAILED', updated: new Date() } });
  }
}

// A deploy/restart empties the in-memory queue — pick back up any Drive
// import still marked PROCESSING once the server has settled.
setTimeout(async () => {
  try {
    const pending = await mongoose
      .model('LiveRecording')
      .find({ status: 'PROCESSING', removed: false, driveFileId: { $exists: true, $ne: null } })
      .select('_id')
      .sort({ startedAt: 1 })
      .lean();
    pending.forEach((r) => enqueueCompression(() => runJob(r._id)));
    if (pending.length) console.log(`[lms] resumed ${pending.length} Drive folder import(s)`);
  } catch (e) {
    console.error('[lms] could not resume Drive folder imports:', e && e.message);
  }
}, 60 * 1000).unref();

module.exports = { status, connect, disconnect, scan, importFiles, progress, runJob };
