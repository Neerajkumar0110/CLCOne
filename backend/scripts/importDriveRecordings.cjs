/* One-off bulk fix: every LiveRecording still on provider:'external' (a
 * pasted Google Drive link) gets re-hosted on the CRM's own server —
 * downloaded from Drive, compressed, and published as a direct file —
 * instead of relying on Drive's /preview iframe, which shows "No preview
 * available" for any viewer without the right Google session/cookies
 * regardless of the file's sharing setting (the actual root cause reported;
 * this isn't a per-file permissions mistake, it's the iframe approach
 * itself being unreliable as a player).
 *
 * DEDUPES BY DRIVE FILE ID FIRST. A real run of this against production
 * found 138 recording rows pointing at only 7 unique Drive files — e.g.
 * "Class 1" through "Class 29" of one batch all carry the exact same link,
 * almost certainly from the Bulk-attach-links screen being used with one
 * link pasted across many class-date rows by mistake. Downloading +
 * compressing the same source file 29 times would waste the VPS's limited
 * CPU/bandwidth for no benefit, so each unique Drive file is fetched and
 * compressed exactly once, then that one resulting hosted URL is applied to
 * every recording row that pointed at it. This does NOT fix which class a
 * recording actually belongs to — that's a separate data question (the
 * right per-class links, if they exist, still need attaching by hand) —
 * it only fixes playback for whatever each row is currently linked to.
 *
 * Runs ONE Drive file at a time on purpose — this VPS has 2 vCPUs and is
 * also running the live CRM API + Nginx + OpenVSCode Server; concurrent
 * downloads/compressions would compete with all of that.
 *
 * Safe to re-run — only touches rows still on provider:'external'.
 *
 * Usage (from backend/):  node scripts/importDriveRecordings.cjs
 */
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to migrate.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const modelsFiles = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js'));
  for (const filePath of modelsFiles) require(path.resolve(filePath));

  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const { downloadDriveFileTo, extractDriveFileId } = require('../src/services/lms/driveImport');
  const { compressVideo } = require('../src/services/lms/recordingCompress');

  function crmBase() {
    return (
      process.env.CODE_EDITOR_PUBLIC_BASE ||
      process.env.PUBLIC_SERVER_FILE ||
      process.env.APP_URL ||
      'https://clcone.careerlabconsulting.com'
    ).replace(/\/+$/, '');
  }

  const rows = await LiveRecording.find({ provider: 'external', removed: false, status: { $ne: 'DELETED' } })
    .select('+downloadUrl +playbackUrl liveSession className')
    .lean();

  const byFileId = new Map(); // fileId -> [rows]
  let skippedNoId = 0;
  for (const rec of rows) {
    const fileId = extractDriveFileId(rec.downloadUrl) || extractDriveFileId(rec.playbackUrl);
    if (!fileId) {
      console.log(`SKIP  ${rec._id}  "${rec.className}" — no Drive file id in its link`);
      skippedNoId += 1;
      continue;
    }
    if (!byFileId.has(fileId)) byFileId.set(fileId, []);
    byFileId.get(fileId).push(rec);
  }

  console.log(
    `Found ${rows.length} recording(s) -> ${byFileId.size} unique Drive file(s) to download (each once).\n`
  );

  let filesOk = 0;
  let filesFailed = 0;
  let rowsUpdated = 0;

  for (const [fileId, recs] of byFileId.entries()) {
    const names = recs.map((r) => r.className).join(', ');
    console.log(`START drive id ${fileId}  — used by ${recs.length} recording(s): ${names.slice(0, 200)}${names.length > 200 ? '…' : ''}`);

    const dir = path.join(__dirname, '..', 'src', 'public', 'uploads', 'recordings');
    await fs.promises.mkdir(dir, { recursive: true });
    // Keyed by Drive file id, not recording id — this is the whole point of
    // the dedupe: one file on disk serves every row that shares this id.
    const rawAbsPath = path.join(dir, `drive-${fileId}-raw.mp4`);
    const compressedAbsPath = path.join(dir, `drive-${fileId}-web.mp4`);
    const compressedRelPath = `public/uploads/recordings/drive-${fileId}-web.mp4`;

    // eslint-disable-next-line no-await-in-loop
    await LiveRecording.updateMany(
      { _id: { $in: recs.map((r) => r._id) } },
      { $set: { status: 'PROCESSING', updated: new Date() } }
    );

    try {
      // eslint-disable-next-line no-await-in-loop
      await downloadDriveFileTo(fileId, rawAbsPath);
      // eslint-disable-next-line no-await-in-loop
      await compressVideo(rawAbsPath, compressedAbsPath);
      fs.unlink(rawAbsPath, () => {});
      const url = `${crmBase()}/${compressedRelPath}`;

      // eslint-disable-next-line no-await-in-loop
      await LiveRecording.updateMany(
        { _id: { $in: recs.map((r) => r._id) } },
        { $set: { status: 'AVAILABLE', provider: 'mock', playbackUrl: url, downloadUrl: url, updated: new Date() } }
      );
      // eslint-disable-next-line no-await-in-loop
      await LmsLiveSession.updateMany(
        { _id: { $in: recs.map((r) => r.liveSession) } },
        { $set: { recordingStatus: 'AVAILABLE', status: 'recording_available', updated: new Date() } }
      );
      console.log(`OK    drive id ${fileId}  -> ${url}  (applied to ${recs.length} recording rows)`);
      filesOk += 1;
      rowsUpdated += recs.length;
    } catch (e) {
      console.error(`FAIL  drive id ${fileId} —`, e.message);
      // eslint-disable-next-line no-await-in-loop
      await LiveRecording.updateMany(
        { _id: { $in: recs.map((r) => r._id) } },
        { $set: { status: 'FAILED', failReason: String(e.message).slice(0, 300), updated: new Date() } }
      );
      // eslint-disable-next-line no-await-in-loop
      await LmsLiveSession.updateMany(
        { _id: { $in: recs.map((r) => r.liveSession) } },
        { $set: { recordingStatus: 'FAILED', updated: new Date() } }
      );
      filesFailed += 1;
    }
  }

  console.log(
    `\nDone. ${filesOk} Drive file(s) imported (${rowsUpdated} recording rows updated), ${filesFailed} file(s) failed, ${skippedNoId} row(s) skipped (no Drive id).`
  );
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
