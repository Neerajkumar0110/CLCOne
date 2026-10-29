/* One-off resync: BBB recordings made before the server had the "video"
 * format (bbb-playback-video) were saved with downloadUrl = the raw
 * webcams.webm fallback (cameras + audio only — no screen share, no
 * slides). Once those recordings are rebuilt on the BBB server
 * (`bbb-record --rebuild <recordID>`), BBB publishes a composited video for
 * each, but the poller (liveClassService.pollRecordings) never revisits a
 * row that's already AVAILABLE — this re-reads every BBB row's formats from
 * getRecordings and swaps in the full video file.
 *
 * Only touches downloadUrl, and only when BBB now offers a proper video
 * file; rows whose rebuild hasn't finished yet are left as they are, so
 * it's safe to re-run as the rebuild queue works through.
 *
 * Usage (from backend/):  node scripts/resyncBbbRecordingDownloads.cjs [--dry]
 */
const path = require('path');
const mongoose = require('mongoose');
const { globSync } = require('glob');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const DRY = process.argv.includes('--dry');

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set — nothing to resync.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DATABASE);
  require('../src/config/multiDb').installMultiDbRouting();
  const modelsFiles = globSync(path.join(__dirname, '..', 'src', 'models', '**', '*.js'));
  for (const filePath of modelsFiles) require(path.resolve(filePath));
  const LiveRecording = mongoose.model('LiveRecording');
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const { BigBlueButtonProvider } = require('../src/services/lms/meeting');
  const provider = new BigBlueButtonProvider();

  const rows = await LiveRecording.find({ removed: false, provider: 'bigbluebutton', recordingId: { $nin: [null, ''] } })
    .select('+downloadUrl recordingId meetingId liveSession className')
    .lean();
  console.log(`Found ${rows.length} BBB recording(s) to check.`);

  // Every class of a batch shares one BBB room, so one getRecordings call
  // per meetingID covers all of that batch's recordings.
  const byMeeting = new Map();
  for (const r of rows) {
    let meetingId = r.meetingId;
    if (!meetingId && r.liveSession) {
      const s = await LmsLiveSession.findById(r.liveSession, 'meetingId').lean();
      meetingId = s && s.meetingId;
    }
    if (!meetingId) continue;
    if (!byMeeting.has(meetingId)) byMeeting.set(meetingId, []);
    byMeeting.get(meetingId).push(r);
  }

  let updated = 0;
  let pending = 0;
  for (const [meetingId, recs] of byMeeting) {
    let fromBbb = [];
    try {
      fromBbb = await provider.getRecordings({ meetingId });
    } catch (e) {
      console.warn(`  getRecordings failed for ${meetingId}: ${e.message}`);
      continue;
    }
    const byId = new Map(fromBbb.map((x) => [x.recordID, x]));
    for (const r of recs) {
      const b = byId.get(r.recordingId);
      if (!b || !b.downloadUrl || /\/webcams\.webm$/.test(b.downloadUrl)) {
        pending += 1;
        continue;
      }
      if (b.downloadUrl === r.downloadUrl) continue;
      console.log(`  ${DRY ? 'would set' : 'set'} ${r.className} -> ${b.downloadUrl}`);
      if (!DRY) {
        await LiveRecording.updateOne(
          { _id: r._id },
          { $set: { downloadUrl: b.downloadUrl, ...(b.sizeBytes ? { sizeBytes: b.sizeBytes } : {}), updated: new Date() } }
        );
      }
      updated += 1;
    }
  }

  console.log(`${DRY ? 'Would update' : 'Updated'} ${updated}; ${pending} still without a full video (rebuild not done yet).`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
