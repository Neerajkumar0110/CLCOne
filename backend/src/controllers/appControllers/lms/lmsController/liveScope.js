const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { liveClassService, lmsConfig } = require('../../../../services/lms');
const settingsService = require('../../../../services/lms/settingsService');
const { compressVideo } = require('../../../../services/lms/recordingCompress');
const { downloadDriveFileTo, extractDriveFileId } = require('../../../../services/lms/driveImport');
const { LMS_FULL_ACCESS_ROLES } = require('../../../../config/roles');

// Students never see a class's recording until this long after the class
// actually ended — gives the teacher room to upload without a partial/
// still-compressing file showing up mid-class.
const RECORDING_STUDENT_DELAY_MS = 2 * 60 * 60 * 1000;

// Role-scoped read APIs for live classes / recordings / attendance.
// Golden rule: course/batch/student ids from the client are NEVER trusted —
// every list is re-scoped from req.admin.

const isManager = (a) => LMS_FULL_ACCESS_ROLES.includes(a.role);

function crmBase() {
  return lmsConfig.meeting.crmBaseUrl.replace(/\/+$/, '');
}

// status: 'active' only — a 'suspended'/'ended' enrolment (set by
// removeStudentFromBatch, or a withdrawn/failed payment) must not still
// grant recording access. Mirrors the same filter resolveRole() already
// applies for live-class join access (services/lms/liveClassService.js) —
// without it, a student removed from a batch/course kept seeing its
// recordings forever through this fallback.
async function myEnrolments(admin) {
  return mongoose.model('LmsEnrolment').find({ crmUser: admin._id, status: 'active' }).lean();
}
async function myMoodleCourseIds(admin) {
  const e = await myEnrolments(admin);
  return [...new Set(e.map((x) => x.moodleCourseId).filter(Boolean))];
}
// The real student<->batch link in this deployment: the Student roster row
// matched by email, `batch` as a plain string name — not LmsEnrolment, which
// stays empty until Moodle sync is configured. Same fallback resolveRole()
// (services/lms/liveClassService.js) and the student dashboard (panel.js)
// already use for live classes, ported here so recordings are scoped the
// same way. status: 'Active' only — spec §2 "Archive/suspend/withdraw states
// must immediately affect access rules": a student marked On Hold/Dropped/
// Deferred/Completed but still listed against the batch must not keep
// recording access through this fallback (mirrors resolveRole()'s roster
// check).
async function myRosterBatchNames(admin) {
  const email = String(admin.email || '').trim().toLowerCase();
  if (!email) return new Set();
  const emailRx = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const rows = await mongoose.model('Student').find({ removed: false, email: emailRx, status: 'Active' }, 'batch').lean();
  return new Set(rows.map((r) => r.batch).filter(Boolean));
}

/* ─────────────── STUDENT (self only) ─────────────── */

// GET /api/lms/student/live-classes?scope=
async function studentLiveClasses(req, res) {
  const rows = await liveClassService.listFor(req.admin, { scope: req.query.scope });
  return res.status(200).json({ success: true, result: rows.filter((r) => r.myRole === 'student' || isManager(req.admin)) });
}

// GET /api/lms/student/attendance?courseTitle=
// Sessions that never actually ran must never contribute to an attendance
// aggregate — today this only holds by an implicit invariant (a cancelled
// session can't yet have participants because cancellation is restricted to
// never-started sessions), but that invariant isn't guaranteed to stay true
// (e.g. if single-session cancellation is later extended to a started
// class), so every aggregate now defensively filters on status too.
const ATTENDANCE_COUNTABLE_STATUSES = ['ended', 'recording_processing', 'recording_available'];

async function studentAttendance(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const me = String(req.admin._id);
  const q = { removed: false, 'participants.crmUser': req.admin._id, status: { $in: ATTENDANCE_COUNTABLE_STATUSES } };
  if (req.query.courseTitle) q.courseTitle = req.query.courseTitle;
  if (req.query.batchName) q.batchName = req.query.batchName;
  const sessions = await LmsLiveSession.find(q).sort({ scheduledStart: 1 }).lean();

  const classes = [];
  let present = 0;
  let partial = 0;
  let absent = 0;
  let late = 0;
  let excused = 0;
  let sumPct = 0;
  let countedClasses = 0;
  for (const s of sessions) {
    const p = (s.participants || []).find((x) => String(x.crmUser) === me);
    if (!p) continue;
    // EXCUSED must not fall into the "else" (absent) bucket, and — like a
    // real attendance policy — an excused class shouldn't drag the % down,
    // so it's kept out of both the status tally and the % average below.
    if (p.attendanceStatus === 'EXCUSED') {
      excused += 1;
    } else {
      countedClasses += 1;
      if (p.attendanceStatus === 'PRESENT') present += 1;
      else if (p.attendanceStatus === 'LATE') { present += 1; late += 1; }
      else if (p.attendanceStatus === 'PARTIAL') partial += 1;
      else absent += 1;
      sumPct += p.attendancePct || 0;
    }
    classes.push({
      date: s.scheduledStart,
      className: s.title,
      courseTitle: s.courseTitle,
      batchName: s.batchName,
      scheduledDurationMin: s.scheduledDurationMin,
      attendedMin: p.totalDurationMin || 0,
      attendancePct: p.attendancePct || 0,
      status: p.attendanceStatus,
      joins: p.joinCount,
    });
  }
  const attendancePct = countedClasses ? Math.round(sumPct / countedClasses) : 0;
  return res.status(200).json({
    success: true,
    result: {
      summary: {
        totalClasses: classes.length,
        present,
        partial,
        absent,
        late,
        excused,
        attendancePct,
      },
      classes,
    },
  });
}

/* ─────────────── RECORDINGS (all roles, scoped) ─────────────── */

async function listRecordings(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const admin = req.admin;
  const q = { removed: false };
  if (req.query.status) q.status = req.query.status;
  if (req.query.courseTitle) q.courseTitle = req.query.courseTitle;
  if (req.query.batchName) q.batchName = req.query.batchName;
  if (req.query.from || req.query.to) {
    q.publishedAt = {
      ...(req.query.from ? { $gte: new Date(req.query.from) } : {}),
      ...(req.query.to ? { $lte: new Date(req.query.to) } : {}),
    };
  }
  // Free-text search across title/course/batch/teacher (spec §11 "searchable
  // library") — the filters above are exact-match dropdowns only; this is
  // the actual search box.
  if (req.query.q && String(req.query.q).trim()) q.$text = { $search: String(req.query.q).trim() };

  // Sorted by the class's own date (the "Date" column), not by when its
  // compression/publish happened to finish — a bulk backfill (e.g. many
  // recordings imported/compressed together) finishes in whatever order the
  // jobs ran, which has nothing to do with Class 1, 2, 3… sequence.
  let rows = await LiveRecording.find(q).select('+playbackUrl +backupUrl').sort({ startedAt: -1, created: -1 }).limit(500).lean();
  const now = new Date();
  const ownTaught = (r) =>
    isManager(admin) ||
    String(r.teacherCrmUser) === String(admin._id) ||
    (r.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase();
  // Students only ever see a recording once it's finished compressing AND
  // the 2-hour-after-class-ended delay has passed; the teacher who
  // uploaded it (or a manager) can watch it immediately to check it.
  const releasedToStudents = (r) => !r.publishedAt || new Date(r.publishedAt) <= now;

  if (!isManager(admin)) {
    const s = await settingsService.get();
    const myCourseIds = await myMoodleCourseIds(admin);
    const myEnr = await myEnrolments(admin);
    const myBatchIds = new Set(myEnr.map((e) => String(e.batch)).filter(Boolean));
    const myBatchNames = await myRosterBatchNames(admin);
    const myCourseTitles = new Set();
    const LmsLiveSession = mongoose.model('LmsLiveSession');
    const linked = await LmsLiveSession.find({ moodleCourseId: { $in: myCourseIds } }, 'courseTitle batch').lean();
    linked.forEach((l) => l.courseTitle && myCourseTitles.add(l.courseTitle));
    const enrolledAccess = (r) => {
      if (r.status !== 'AVAILABLE') return false;
      if (!releasedToStudents(r)) return false;
      if (s.recordingAccess === 'admin-only') return false;
      // Roster batch match always grants access — it's the source of truth
      // for "which batch is this student in" while Moodle sync is unused.
      if (myBatchNames.has(r.batchName)) return true;
      if (s.recordingAccess === 'batch') return myBatchIds.has(String(r.batch));
      return myCourseTitles.has(r.courseTitle);
    };
    rows = rows.filter((r) => ownTaught(r) || enrolledAccess(r));
  }

  return res.status(200).json({
    success: true,
    result: rows.map((r) => ({
      id: String(r._id),
      className: r.className,
      courseTitle: r.courseTitle,
      batchName: r.batchName,
      teacherName: r.teacherName,
      date: r.startedAt || r.created,
      durationMin: r.durationMin,
      status: r.status,
      provider: r.provider,
      views: r.views,
      // Manager-only, same reasoning as hasBackup below — a student doesn't
      // get to see who else in the batch has/hasn't watched a class.
      viewerNames: isManager(admin)
        ? (r.viewedBy || [])
            .slice()
            .sort((a, b) => new Date(b.lastViewedAt || 0) - new Date(a.lastViewedAt || 0))
            .map((v) => v.name)
            .filter(Boolean)
        : undefined,
      sizeBytes: r.sizeBytes || 0,
      publishedAt: r.publishedAt,
      // status AVAILABLE with no playbackUrl is a stale row from before the
      // manual-upload flow existed (or a failed compress) — canPlay stays
      // false and hasVideo tells the teacher's "Upload recording" button to
      // show again for it instead of treating it as already done.
      hasVideo: !!r.playbackUrl,
      canPlay: r.status === 'AVAILABLE' && !!r.playbackUrl && (ownTaught(r) || releasedToStudents(r)),
      // Manager-only visibility into whether a manual backup link has been
      // recorded for this recording (spec §11) — never surfaced to students.
      hasBackup: isManager(admin) ? !!r.backupUrl : undefined,
    })),
  });
}

// GET /api/lms/recordings/:id/play  -> { url }  (access re-checked here)
async function playRecording(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const admin = req.admin;
  const rec = await LiveRecording.findById(req.params.id).select('+playbackUrl +downloadUrl');
  if (!rec || rec.removed) return res.status(404).json({ success: false, message: 'Recording not found.' });
  if (rec.status !== 'AVAILABLE') return res.status(409).json({ success: false, message: `Recording is ${rec.status}.` });

  let allowed = isManager(admin);
  if (!allowed && (String(rec.teacherCrmUser) === String(admin._id) || (rec.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase())) {
    allowed = true;
  }
  if (!allowed) {
    // Everyone below this point is a student — not released yet means not
    // watchable yet, full stop (still compressing, or inside the 2-hour
    // post-class delay).
    if (rec.publishedAt && new Date(rec.publishedAt) > new Date()) {
      return res.status(409).json({ success: false, message: 'This recording isn\'t available to candidates yet.' });
    }
    const s = await settingsService.get();
    if (s.recordingAccess !== 'admin-only') {
      const session = await LmsLiveSession.findById(rec.liveSession).lean();
      if (session) {
        const myBatchNames = await myRosterBatchNames(admin);
        const myCourseIds = await myMoodleCourseIds(admin);
        const enr = await mongoose
          .model('LmsEnrolment')
          .findOne({ crmUser: admin._id, moodleCourseId: session.moodleCourseId, status: 'active' });
        allowed =
          myBatchNames.has(session.batchName) ||
          !!enr ||
          (session.participants || []).some((p) => String(p.crmUser) === String(admin._id));
      }
    }
  }
  if (!allowed) return res.status(403).json({ success: false, message: 'You do not have access to this recording.' });

  const now = new Date();
  const bumped = await LiveRecording.updateOne(
    { _id: rec._id, 'viewedBy.crmUser': admin._id },
    { $inc: { views: 1, 'viewedBy.$.count': 1 }, $set: { lastViewedAt: now, 'viewedBy.$.lastViewedAt': now } }
  );
  if (!bumped.matchedCount) {
    // First time this admin has watched it — no existing viewedBy entry to
    // bump, so add one (and still count the play itself).
    await LiveRecording.updateOne(
      { _id: rec._id },
      {
        $inc: { views: 1 },
        $set: { lastViewedAt: now },
        $push: { viewedBy: { crmUser: admin._id, name: admin.name, count: 1, lastViewedAt: now } },
      }
    );
  }
  return res.status(200).json({ success: true, result: { url: rec.playbackUrl || null, provider: rec.provider } });
}

// POST /api/lms/recordings/:id/upload  (multipart, field "file") — the class
// teacher or a manager attaches the video they recorded themselves. BBB
// records automatically (see BigBlueButtonProvider + pollRecordings), but
// the mock provider (no BBB configured) has no recorder of its own, so this
// manual step is the fallback that gets a recording in front of its batch.
// Students never record anything — upload is teacher/manager-only (checked
// below) and the button is hidden from students on the frontend too.
async function uploadRecording(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const admin = req.admin;
  const rec = await LiveRecording.findById(req.params.id);
  if (!rec || rec.removed) return res.status(404).json({ success: false, message: 'Recording not found.' });

  const allowed =
    isManager(admin) ||
    String(rec.teacherCrmUser) === String(admin._id) ||
    (rec.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase();
  if (!allowed) return res.status(403).json({ success: false, message: 'Only this class\'s instructor or a manager can upload its recording.' });

  if (!req.body.video) return res.status(400).json({ success: false, message: 'No video file received.' });

  const now = new Date();
  const rawRelPath = req.body.video; // e.g. "public/uploads/recordings/xxx.mp4" — URL-facing path
  const compressedRelPath = rawRelPath.replace(/\.[^./]+$/, '-web.mp4');
  // The uploadMiddleware writes the file under src/public/... (see
  // singleStorageUpload's `destination`) while req.body.video is the
  // URL-facing "public/..." path (what corePublicRouter's catch-all maps
  // back to src/public/... for playback) — same prefix mismatch, so the
  // actual filesystem path needs the "src/" back on for ffmpeg to find it.
  const rawAbsPath = path.join(process.cwd(), 'src', rawRelPath);
  const compressedAbsPath = path.join(process.cwd(), 'src', compressedRelPath);

  // Not AVAILABLE yet — the file is still being compressed, and even once
  // it's done students don't see it until 2 hours after the class ended.
  await LiveRecording.updateOne({ _id: rec._id }, { $set: { status: 'PROCESSING', updated: now } });
  await LmsLiveSession.updateOne(
    { _id: rec.liveSession },
    { $set: { recordingStatus: 'PROCESSING', status: 'recording_processing', updated: now } }
  );
  res.status(200).json({
    success: true,
    result: { id: String(rec._id), status: 'PROCESSING', message: 'Uploaded — compressing now. Candidates see it once ready, 2 hours after the class ended.' },
  });

  // Compress in the background, queued — see compressionQueue below. The
  // HTTP response above already went out; multer has already finished
  // writing rawAbsPath to disk by this point regardless of how many other
  // uploads are landing concurrently, so queuing only the compression step
  // (not the upload itself) is enough to keep ffmpeg to one job at a time
  // server-wide without making concurrent uploads wait on each other.
  enqueueCompression(() =>
    compressVideo(rawAbsPath, compressedAbsPath)
      .then(async () => {
        fs.unlink(rawAbsPath, () => {}); // drop the raw upload, keep only the compressed copy
        const url = `${crmBase()}/${compressedRelPath}`;
        const session = await LmsLiveSession.findById(rec.liveSession).select('actualEnd').lean();
        const earliestForStudents = session && session.actualEnd
          ? new Date(new Date(session.actualEnd).getTime() + RECORDING_STUDENT_DELAY_MS)
          : new Date();
        const publishedAt = earliestForStudents > new Date() ? earliestForStudents : new Date();
        const doneAt = new Date();
        // Best-effort — a stat failure shouldn't fail the whole publish, the
        // recording just shows no size (same as any pre-existing row).
        let sizeBytes;
        try {
          sizeBytes = (await fs.promises.stat(compressedAbsPath)).size;
        } catch (e) { /* leave sizeBytes undefined */ }
        await LiveRecording.updateOne(
          { _id: rec._id },
          // provider -> 'mock' regardless of what it was before (e.g. 'external'
          // on a recording whose Drive link was unreliable and got re-uploaded
          // directly instead) — this is always our own hosted file from here
          // on, and the frontend player picks <video> vs <iframe> off this
          // field, not the URL shape.
          { $set: { status: 'AVAILABLE', provider: 'mock', playbackUrl: url, downloadUrl: url, publishedAt, updated: doneAt, ...(sizeBytes !== undefined ? { sizeBytes } : {}) } }
        );
        await LmsLiveSession.updateOne(
          { _id: rec.liveSession },
          { $set: { recordingStatus: 'AVAILABLE', status: 'recording_available', updated: doneAt } }
        );
      })
      .catch(async (e) => {
        console.error('[lms] recording compression failed:', e && e.message);
        await LiveRecording.updateOne({ _id: rec._id }, { $set: { status: 'FAILED', failReason: String(e && e.message).slice(0, 300), updated: new Date() } });
      })
  );
}

// Serial queue shared by every path that runs ffmpeg in the background
// (manual upload below, and Drive import further down) — this VPS has a
// handful of vCPUs and already runs the live CRM API, Nginx, BigBlueButton,
// VICIdial, and (per deploy/vps/code-editor-branding) OpenVSCode Server on
// it. A batch of uploads/imports landing close together would otherwise
// fire that many concurrent downloads + ffmpeg compressions at once; this
// runs them one at a time instead; so no matter how many requests arrive
// together, only one compression ever runs at a time, server-wide.
const compressionQueue = [];
let compressionQueueRunning = false;

function enqueueCompression(job) {
  compressionQueue.push(job);
  if (!compressionQueueRunning) runCompressionQueue();
}

async function runCompressionQueue() {
  compressionQueueRunning = true;
  while (compressionQueue.length) {
    const job = compressionQueue.shift();
    await job().catch((e) => console.error('[lms] queued compression job threw unexpectedly:', e && e.message));
  }
  compressionQueueRunning = false;
}

// POST /api/lms/admin/recordings/:id/import-drive  (manager only)
// Pulls the file bytes straight from Google Drive and re-hosts them on the
// CRM's own server, exactly like a manual upload — fixes the single most
// common recording-playback failure (Drive's /preview iframe showing "No
// preview available" for a viewer without the right Google session/cookies,
// regardless of the file's sharing setting) without needing the teacher to
// still have the original file to re-upload by hand.
async function importDriveRecording(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const rec = await LiveRecording.findById(req.params.id).select('+downloadUrl +playbackUrl');
  if (!rec || rec.removed) return res.status(404).json({ success: false, message: 'Recording not found.' });

  const fileId = extractDriveFileId(rec.downloadUrl) || extractDriveFileId(rec.playbackUrl);
  if (!fileId) {
    return res.status(400).json({ success: false, message: 'This recording has no Google Drive link to import from.' });
  }

  const now = new Date();
  await LiveRecording.updateOne({ _id: rec._id }, { $set: { status: 'PROCESSING', updated: now } });
  await LmsLiveSession.updateOne(
    { _id: rec.liveSession },
    { $set: { recordingStatus: 'PROCESSING', status: 'recording_processing', updated: now } }
  );
  res.status(200).json({
    success: true,
    result: { id: String(rec._id), status: 'PROCESSING', message: 'Queued to import from Google Drive — this can take a while for a lot of classes, one at a time.' },
  });

  // Queued, not fired immediately — see compressionQueue above. HTTP
  // response already went out.
  enqueueCompression(() => runDriveImportJob(rec, fileId));
}

async function runDriveImportJob(rec, fileId) {
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const dir = path.join(process.cwd(), 'src', 'public', 'uploads', 'recordings');
  await fs.promises.mkdir(dir, { recursive: true });
  const rawAbsPath = path.join(dir, `${rec._id}-drive-raw.mp4`);
  const compressedAbsPath = path.join(dir, `${rec._id}-web.mp4`);
  const compressedRelPath = `public/uploads/recordings/${rec._id}-web.mp4`;
  try {
    await downloadDriveFileTo(fileId, rawAbsPath);
    await compressVideo(rawAbsPath, compressedAbsPath);
    fs.unlink(rawAbsPath, () => {});
    const url = `${crmBase()}/${compressedRelPath}`;
    let sizeBytes;
    try {
      sizeBytes = (await fs.promises.stat(compressedAbsPath)).size;
    } catch (e) { /* leave sizeBytes undefined */ }
    await LiveRecording.updateOne(
      { _id: rec._id },
      // publishedAt is left untouched on purpose — this recording was
      // already published (it's being RE-hosted, not freshly uploaded), so
      // re-applying the 2-hour student delay would wrongly hide an
      // already-announced recording again.
      { $set: { status: 'AVAILABLE', provider: 'mock', playbackUrl: url, downloadUrl: url, updated: new Date(), ...(sizeBytes !== undefined ? { sizeBytes } : {}) } }
    );
    await LmsLiveSession.updateOne(
      { _id: rec.liveSession },
      { $set: { recordingStatus: 'AVAILABLE', status: 'recording_available', updated: new Date() } }
    );
  } catch (e) {
    console.error('[lms] Drive import failed for recording', rec._id, ':', e && e.message);
    await LiveRecording.updateOne(
      { _id: rec._id },
      { $set: { status: 'FAILED', failReason: String(e && e.message).slice(0, 300), updated: new Date() } }
    );
    await LmsLiveSession.updateOne(
      { _id: rec.liveSession },
      { $set: { recordingStatus: 'FAILED', updated: new Date() } }
    );
  }
}

// POST /api/lms/admin/recordings/:id/delete   (manager only — route guards)
async function deleteRecording(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const r = await LiveRecording.findByIdAndUpdate(
    req.params.id,
    { $set: { status: 'DELETED', updated: new Date() } },
    { new: true }
  );
  if (!r) return res.status(404).json({ success: false, message: 'Recording not found.' });
  // metadata is kept on purpose
  return res.status(200).json({ success: true, result: { id: String(r._id), status: r.status } });
}

// POST /api/lms/admin/recordings/:id/backup   { backupUrl }  (manager only)
// Spec §11 "backup links" — see the LiveRecording.backupUrl model comment:
// this is a manually-recorded mirror location, not an automated one.
async function setBackupUrl(req, res) {
  const LiveRecording = mongoose.model('LiveRecording');
  const backupUrl = String((req.body || {}).backupUrl || '').trim();
  const r = await LiveRecording.findByIdAndUpdate(
    req.params.id,
    { $set: { backupUrl, backupUpdatedAt: backupUrl ? new Date() : undefined, updated: new Date() } },
    { new: true }
  ).select('+backupUrl');
  if (!r) return res.status(404).json({ success: false, message: 'Recording not found.' });
  return res.status(200).json({ success: true, result: { id: String(r._id), hasBackup: !!r.backupUrl } });
}

/* ─────────────── EXTERNAL RECORDING LINKS (backfill — Drive, etc.) ─────────────── */

// A Google Drive "share" link (/file/d/<id>/view, /open?id=<id>, /uc?id=<id>)
// isn't itself a playable video — it's an HTML viewer page — so it can't go
// into a plain <video src>. Drive's own /preview path embeds fine in an
// <iframe> (same trick the frontend already uses for BBB's playback page),
// so that's what becomes playbackUrl; the original share link is kept as
// downloadUrl since that's the one that actually offers a download. Any
// other URL (a direct .mp4 host, YouTube unlisted, etc.) is left exactly as
// given — the frontend falls back to an <iframe> for anything that isn't a
// recognizable direct video file anyway.
function normalizeExternalRecordingUrl(raw) {
  const url = String(raw || '').trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;
  let id = null;
  let m = /drive\.google\.com\/file\/d\/([^/?]+)/.exec(url);
  if (m) id = m[1];
  if (!id) {
    m = /drive\.google\.com\/.*[?&]id=([^&]+)/.exec(url);
    if (m) id = m[1];
  }
  if (id) {
    return {
      playbackUrl: `https://drive.google.com/file/d/${id}/preview`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`,
    };
  }
  return { playbackUrl: url, downloadUrl: url };
}

// Upserts the LiveRecording for one session — a historical/backfilled
// session (created outside the normal start/end-class flow) never got one
// automatically, and even a normal session's existing row is fine to
// overwrite here (an admin pasting a link is an explicit, deliberate
// correction). Denormalised fields are read straight off the session so the
// Recordings list/search never needs a join.
async function attachLinkToSession(sessionId, rawUrl) {
  const norm = normalizeExternalRecordingUrl(rawUrl);
  if (!norm) throw new Error('A valid http(s) URL is required.');

  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const session = await LmsLiveSession.findById(sessionId).lean();
  if (!session) throw new Error('Class session not found.');

  const now = new Date();
  await LiveRecording.findOneAndUpdate(
    { liveSession: session._id },
    {
      $set: {
        liveClass: session.liveClass,
        crmCourse: session.crmCourse,
        batch: session.batch,
        teacherCrmUser: session.teacherCrmUser,
        courseTitle: session.courseTitle,
        batchName: session.batchName,
        teacherName: session.teacherName,
        className: session.title,
        provider: 'external',
        status: 'AVAILABLE',
        startedAt: session.actualStart || session.scheduledStart,
        endedAt: session.actualEnd || session.scheduledEnd,
        durationMin: session.scheduledDurationMin || 0,
        publishedAt: now,
        playbackUrl: norm.playbackUrl,
        downloadUrl: norm.downloadUrl,
        removed: false,
        updated: now,
      },
      $setOnInsert: { liveSession: session._id, created: now },
    },
    { upsert: true }
  );
  await LmsLiveSession.updateOne({ _id: session._id }, { $set: { recordingStatus: 'AVAILABLE' } });
}

// POST /api/lms/sessions/:id/recording-link   { url }
// (the class's own instructor, or a manager)
async function attachRecordingLink(req, res) {
  const admin = req.admin;
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const session = await LmsLiveSession.findById(req.params.id).select('teacherCrmUser teacherName').lean();
  if (!session) return res.status(404).json({ success: false, message: 'Class session not found.' });

  const allowed =
    isManager(admin) ||
    String(session.teacherCrmUser) === String(admin._id) ||
    (session.teacherName || '').toLowerCase() === (admin.name || '').toLowerCase();
  if (!allowed) return res.status(403).json({ success: false, message: "Only this class's instructor or a manager can attach its recording." });

  try {
    await attachLinkToSession(req.params.id, (req.body || {}).url);
    return res.status(200).json({ success: true, result: { message: 'Recording attached.' } });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

// POST /api/lms/admin/batches/:id/recording-links   { links: [{ date: 'YYYY-MM-DD', url }] }
// (manager only — route guards) — matches each date to that batch's session
// scheduled on that IST calendar day, so a whole batch's backlog of old
// Drive recordings can be dropped in one paste instead of one row at a time.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateKeyOf(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}
async function bulkAttachRecordingLinks(req, res) {
  const Batch = mongoose.model('Batch');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const batch = await Batch.findOne({ _id: req.params.id, removed: false }).lean();
  if (!batch) return res.status(404).json({ success: false, message: 'Batch not found.' });

  const links = Array.isArray((req.body || {}).links) ? req.body.links : [];
  const sessions = await LmsLiveSession.find({ batch: batch._id, removed: false }).select('_id scheduledStart').lean();
  const byDateKey = new Map();
  sessions.forEach((s) => {
    if (s.scheduledStart) byDateKey.set(istDateKeyOf(s.scheduledStart), s._id);
  });

  const results = [];
  for (const row of links) {
    const date = String((row && row.date) || '').trim();
    const url = String((row && row.url) || '').trim();
    if (!date || !url) {
      results.push({ date, ok: false, message: 'Missing date or URL.' });
      continue;
    }
    const sessionId = byDateKey.get(date);
    if (!sessionId) {
      results.push({ date, ok: false, message: 'No class scheduled on this date for this batch.' });
      continue;
    }
    try {
      await attachLinkToSession(sessionId, url);
      results.push({ date, ok: true });
    } catch (e) {
      results.push({ date, ok: false, message: e.message });
    }
  }
  return res.status(200).json({ success: true, result: { results } });
}

/* ─────────────── ATTENDANCE DASHBOARD (teacher scoped / admin all) ─────────────── */

async function attendanceDashboard(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const admin = req.admin;
  const mgr = isManager(admin);

  // Excludes cancelled only (not scheduled/live/ending) — this dashboard
  // intentionally still shows in-progress/future classes for real-time
  // monitoring (see completedClasses below), it's specifically a cancelled
  // class's (empty, by current invariant — see ATTENDANCE_COUNTABLE_STATUSES
  // comment above) participants that must never count toward the KPIs.
  const q = { removed: false, status: { $ne: 'cancelled' } };
  if (req.query.courseTitle) q.courseTitle = req.query.courseTitle;
  if (req.query.batchName) q.batchName = req.query.batchName;
  if (req.query.teacherName) q.teacherName = req.query.teacherName;
  if (req.query.classId) q._id = req.query.classId;
  if (req.query.from || req.query.to) {
    q.scheduledStart = {
      ...(req.query.from ? { $gte: new Date(req.query.from) } : {}),
      ...(req.query.to ? { $lte: new Date(req.query.to) } : {}),
    };
  }
  if (!mgr) {
    q.$or = [{ teacherCrmUser: admin._id }, { teacherName: admin.name }];
  }

  const sessions = await LmsLiveSession.find(q).sort({ scheduledStart: -1 }).limit(1000).lean();
  const studentQ = (req.query.student || '').toLowerCase();

  const rows = [];
  let present = 0;
  let partial = 0;
  let absent = 0;
  let late = 0;
  let excused = 0;
  let durSum = 0;
  let pctSum = 0;
  let cnt = 0;
  const completedClasses = sessions.filter((s) => ['ended', 'recording_processing', 'recording_available'].includes(s.status)).length;

  for (const s of sessions) {
    for (const p of s.participants || []) {
      if (p.role !== 'student') continue;
      if (studentQ && !(`${p.name} ${p.email || ''}`.toLowerCase().includes(studentQ))) continue;
      if (req.query.status && p.attendanceStatus !== String(req.query.status).toUpperCase()) continue;
      // EXCUSED must not fall into the "else" (absent) bucket, and — like
      // studentAttendance() above — shouldn't drag avgAttendancePct/
      // avgDurationMin down, so it's kept out of cnt/durSum/pctSum too.
      if (p.attendanceStatus === 'EXCUSED') {
        excused += 1;
      } else {
        cnt += 1;
        durSum += p.totalDurationMin || 0;
        pctSum += p.attendancePct || 0;
        if (p.attendanceStatus === 'PRESENT') present += 1;
        else if (p.attendanceStatus === 'LATE') { present += 1; late += 1; }
        else if (p.attendanceStatus === 'PARTIAL') partial += 1;
        else absent += 1;
      }
      rows.push({
        sessionId: String(s._id),
        crmUser: p.crmUser ? String(p.crmUser) : undefined,
        studentName: p.name,
        email: p.email,
        batch: s.batchName,
        course: s.courseTitle,
        className: s.title,
        date: s.scheduledStart,
        scheduledDurationMin: s.scheduledDurationMin,
        joinTime: p.firstJoinAt,
        leaveTime: p.lastLeftAt,
        totalDurationMin: p.totalDurationMin || 0,
        attendancePct: p.attendancePct || 0,
        status: p.attendanceStatus,
        joins: p.joinCount,
        leaves: p.leaveCount,
        corrected: !!p.correctedAt,
        correctedByName: p.correctedByName,
        correctedReason: p.correctedReason,
      });
    }
  }

  const uniqueStudents = new Set(rows.map((r) => r.email || r.studentName)).size;
  return res.status(200).json({
    success: true,
    result: {
      kpis: {
        totalStudents: uniqueStudents,
        present,
        partial,
        absent,
        late,
        excused,
        avgAttendancePct: cnt ? Math.round(pctSum / cnt) : 0,
        avgDurationMin: cnt ? Math.round(durSum / cnt) : 0,
        totalClasses: sessions.length,
        completedClasses,
      },
      rows: rows.slice(0, Number(req.query.limit) || 500),
    },
  });
}

// GET /api/lms/(admin|teacher)/attendance/export?format=csv
async function attendanceExport(req, res) {
  // reuse the dashboard aggregation
  const fakeRes = {
    _json: null,
    status() {
      return this;
    },
    json(x) {
      this._json = x;
      return this;
    },
  };
  await attendanceDashboard(req, fakeRes);
  const rows = (fakeRes._json && fakeRes._json.result && fakeRes._json.result.rows) || [];
  const format = (req.query.format || 'csv').toLowerCase();

  const headers = [
    'Candidate',
    'Email',
    'Batch',
    'Course',
    'Class',
    'Date',
    'Scheduled Min',
    'Join Time',
    'Leave Time',
    'Total Min',
    'Attendance %',
    'Status',
    'Joins',
    'Leaves',
  ];
  const line = (r) =>
    [
      r.studentName,
      r.email || '',
      r.batch || '',
      r.course || '',
      r.className || '',
      r.date ? new Date(r.date).toISOString() : '',
      r.scheduledDurationMin,
      r.joinTime ? new Date(r.joinTime).toISOString() : '',
      r.leaveTime ? new Date(r.leaveTime).toISOString() : '',
      r.totalDurationMin,
      r.attendancePct,
      r.status,
      r.joins,
      r.leaves,
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');

  if (format === 'xlsx') {
    try {
      const XLSX = require('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance.xlsx"');
      return res.status(200).send(buf);
    } catch (e) {
      // fall through to csv
    }
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance.csv"`);
  return res.status(200).send([headers.join(','), ...rows.map(line)].join('\n'));
}

/* ─────────────── ADMIN monitoring + analytics ─────────────── */

async function liveMonitor(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const live = await LmsLiveSession.find({ removed: false, status: { $in: ['live', 'starting'] } })
    .sort({ actualStart: -1 })
    .lean();
  return res.status(200).json({
    success: true,
    result: live.map((s) => ({
      id: String(s._id),
      className: s.title,
      courseTitle: s.courseTitle,
      batchName: s.batchName,
      teacherName: s.teacherName,
      startedAt: s.actualStart,
      durationMin: s.actualStart ? Math.round((Date.now() - new Date(s.actualStart)) / 60000) : 0,
      studentsOnline: (s.participants || []).filter((p) => p.online && p.role === 'student').length,
      totalStudents: (s.participants || []).filter((p) => p.role === 'student').length,
      recordingStatus: s.recordingStatus,
      provider: s.meetingProvider,
    })),
  });
}

async function analytics(req, res) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const [courses, batches, students, teachers, totalClasses, completed, recordings] = await Promise.all([
    mongoose.model('Course').countDocuments({ removed: false }),
    mongoose.model('Batch').countDocuments({ removed: false }),
    mongoose.model('Student').countDocuments({ removed: false }),
    mongoose.model('Admin').countDocuments({ removed: false }),
    LmsLiveSession.countDocuments({ removed: false }),
    LmsLiveSession.countDocuments({ removed: false, status: { $in: ['ended', 'recording_processing', 'recording_available'] } }),
    LiveRecording.countDocuments({ removed: false, status: 'AVAILABLE' }),
  ]);

  // attendance trend — last 30 days, avg % per day
  const since = new Date(Date.now() - 30 * 86400000);
  const recent = await LmsLiveSession.find({ removed: false, scheduledStart: { $gte: since } }, 'scheduledStart participants').lean();
  const byDay = {};
  for (const s of recent) {
    const d = new Date(s.scheduledStart).toISOString().slice(0, 10);
    const st = (s.participants || []).filter((p) => p.role === 'student');
    if (!st.length) continue;
    byDay[d] = byDay[d] || { sum: 0, n: 0 };
    st.forEach((p) => {
      byDay[d].sum += p.attendancePct || 0;
      byDay[d].n += 1;
    });
  }
  const trend = Object.entries(byDay)
    .sort()
    .map(([date, v]) => ({ date, avgAttendancePct: Math.round(v.sum / v.n) }));

  return res.status(200).json({
    success: true,
    result: {
      totals: { courses, batches, students, teachers, totalClasses, completedClasses: completed, recordings },
      attendanceTrend: trend,
    },
  });
}

/* ─────────────── settings ─────────────── */
async function getSettings(req, res) {
  return res.status(200).json({ success: true, result: await settingsService.get(true) });
}
async function updateSettings(req, res) {
  return res.status(200).json({ success: true, result: await settingsService.update(req.body || {}) });
}

// GET /api/lms/live-settings/join-policy — any authenticated user (not just
// managers) needs to know whether camera is mandatory before it can gate
// their own Join button. Deliberately a narrow read, not the full settings
// dump (which stays manager-only via /admin/live-settings).
async function joinPolicy(req, res) {
  const s = await settingsService.get();
  return res.status(200).json({
    success: true,
    result: {
      deviceCheckRequired: s.deviceCheckRequired,
      cameraRequiredToJoin: s.cameraRequiredToJoin,
      studentCamera: s.studentCamera,
      studentMic: s.studentMic,
    },
  });
}

// POST /api/lms/live-classes/:id/attendance/correct — manager only. See
// spec §5 "Admin correction: authorized admin can correct attendance only
// with reason, timestamp and audit log" — the audit trail write is here,
// not just the on-row trace, so it shows up in the org-wide AuditLog too.
async function correctAttendanceHandler(req, res) {
  if (!isManager(req.admin)) return res.status(403).json({ success: false, message: 'Management role required.' });
  const b = req.body || {};
  if (!b.crmUserId || !b.status || !String(b.reason || '').trim())
    return res.status(400).json({ success: false, message: 'crmUserId, status and reason are all required.' });
  if (!['PRESENT', 'PARTIAL', 'ABSENT', 'LATE', 'EXCUSED'].includes(b.status))
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  try {
    const result = await liveClassService.correctAttendance(req.params.id, {
      crmUserId: b.crmUserId,
      status: b.status,
      reason: b.reason.trim(),
      admin: req.admin,
    });
    const auditLog = require('../../../../services/lms/auditLog');
    await auditLog.record({
      module: 'attendance',
      action: 'correct',
      entityType: 'LmsLiveSession',
      entityId: req.params.id,
      admin: req.admin,
      reason: b.reason.trim(),
      before: { student: result.email, ...result.before },
      after: { student: result.email, status: result.status },
    });
    return res.status(200).json({ success: true, result, message: `Attendance corrected to ${result.status}.` });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

module.exports = {
  studentLiveClasses,
  studentAttendance,
  listRecordings,
  playRecording,
  uploadRecording,
  importDriveRecording,
  deleteRecording,
  setBackupUrl,
  attachRecordingLink,
  bulkAttachRecordingLinks,
  attachLinkToSession,
  attendanceDashboard,
  attendanceExport,
  liveMonitor,
  analytics,
  getSettings,
  updateSettings,
  joinPolicy,
  correctAttendanceHandler,
};
