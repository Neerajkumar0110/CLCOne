/* eslint-disable no-console */
// One-off, idempotent migration for the LiveClass system.
//
//   node scripts/lms-live-migrate.cjs            # apply
//   node scripts/lms-live-migrate.cjs --dry-run  # report only, write nothing
//
// It is ADDITIVE and safe to re-run. It does three things:
//   1. Legacy enum coercion — pre-v2 LmsLiveSession docs stored lowercase
//      recordingStatus ("none"/"recording"/…) and a flat participant shape
//      ({ joinedAt, leftAt, durationMin, attendanceStatus:'partial' }). These
//      now fail Mongoose validation on .save() (e.g. "recordingStatus: 'none'
//      is not a valid enum value" when a teacher clicks Start). We normalise
//      them in place.
//   2. Missing LiveRecording rows — every recording-enabled session should
//      have exactly one LiveRecording summary row; create any that are absent.
//   3. Per-batch persistent room ("same link ≥ 6 months") — every batch that
//      already has auto-generated classes gets one LmsBatchRoom, and its
//      still-scheduled / upcoming sessions are re-pointed at that shared room
//      (batchRoom + roomName + publicKey). Sessions that are live / ending /
//      ended / cancelled are left untouched so a class in progress is never
//      disturbed.
//
// Nothing here touches VICIdial / Asterisk / the `asterisk` DB / production
// nginx — it only reads and writes the CRM's own LMS collections.

require('module-alias/register');
const path = require('path');
const { globSync } = require('glob');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const DRY = process.argv.includes('--dry-run') || process.argv.includes('-n');

(async () => {
  if (!process.env.DATABASE) {
    console.error('DATABASE env var is not set (backend/.env). Aborting.');
    process.exit(1);
  }

  // register every model exactly like server.js
  const modelGlob = path.join(__dirname, '..', 'src', 'models', '**', '*.js').split(path.sep).join('/');
  globSync(modelGlob).forEach((f) => require(f));

  await mongoose.connect(process.env.DATABASE, { serverSelectionTimeoutMS: 10000 });
  console.log(`connected: ${mongoose.connection.name}${DRY ? '   (DRY RUN — no writes)' : ''}\n`);

  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LiveRecording = mongoose.model('LiveRecording');
  const Batch = mongoose.model('Batch');
  const liveClassService = require('../src/services/lms').liveClassService;

  const REC_ENUM = ['NOT_STARTED', 'RECORDING', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETED'];
  const ATT_ENUM = ['PRESENT', 'PARTIAL', 'ABSENT', 'LATE', 'EXCUSED'];
  const RS_MAP = {
    none: 'NOT_STARTED', not_started: 'NOT_STARTED', recording: 'RECORDING',
    processing: 'PROCESSING', available: 'AVAILABLE', failed: 'FAILED', deleted: 'DELETED',
  };

  const stat = { legacyScanned: 0, legacyFixed: 0, recCreated: 0, batchRooms: 0, sessionsRepointed: 0 };

  // ── 1 + 2 : legacy coercion + missing recording rows ──────────────────
  const cursor = LmsLiveSession.find({ removed: { $ne: true } }).cursor();
  for (let doc = await cursor.next(); doc; doc = await cursor.next()) {
    stat.legacyScanned += 1;
    let dirty = false;

    if (doc.recordingStatus && !REC_ENUM.includes(doc.recordingStatus)) {
      doc.recordingStatus = RS_MAP[String(doc.recordingStatus).toLowerCase()] || 'NOT_STARTED';
      dirty = true;
    }
    for (const p of doc.participants || []) {
      const raw = (p.toObject ? p.toObject() : p) || {};
      if (p.attendanceStatus && !ATT_ENUM.includes(p.attendanceStatus)) {
        const up = String(p.attendanceStatus).toUpperCase();
        p.attendanceStatus = ATT_ENUM.includes(up) ? up : 'ABSENT';
        dirty = true;
      }
      if (!p.firstJoinAt && raw.joinedAt) { p.firstJoinAt = raw.joinedAt; dirty = true; }
      if (!p.lastLeftAt && raw.leftAt) { p.lastLeftAt = raw.leftAt; dirty = true; }
      if ((!p.sessions || p.sessions.length === 0) && raw.joinedAt) {
        p.sessions = [{ joinedAt: raw.joinedAt, leftAt: raw.leftAt || undefined, durationMin: raw.durationMin || 0, source: 'reconcile' }];
        dirty = true;
      }
      if (!p.totalDurationMin && raw.durationMin) { p.totalDurationMin = raw.durationMin; dirty = true; }
    }

    if (dirty) {
      stat.legacyFixed += 1;
      if (!DRY) await doc.save();
    }

    if (doc.recordingEnabled) {
      const has = await LiveRecording.countDocuments({ liveSession: doc._id });
      if (!has) {
        stat.recCreated += 1;
        if (!DRY) {
          await LiveRecording.create({
            liveSession: doc._id,
            liveClass: doc.liveClass,
            crmCourse: doc.crmCourse,
            batch: doc.batch,
            teacherCrmUser: doc.teacherCrmUser,
            courseTitle: doc.courseTitle,
            batchName: doc.batchName,
            teacherName: doc.teacherName,
            className: doc.title,
            provider: doc.meetingProvider || 'mock',
            meetingId: doc.meetingId,
            status: REC_ENUM.includes(doc.recordingStatus) ? doc.recordingStatus : 'NOT_STARTED',
          });
        }
      }
    }
  }

  // ── 3 : per-batch persistent room ────────────────────────────────────
  const batchIds = await LmsLiveSession.distinct('batch', { removed: { $ne: true }, batch: { $ne: null } });
  for (const batchId of batchIds) {
    const batch = await Batch.findById(batchId);
    if (!batch) continue;

    let room = await mongoose.model('LmsBatchRoom').findOne({ batch: batchId });
    if (!room) {
      stat.batchRooms += 1;
      if (!DRY) room = await liveClassService.ensureBatchRoom(batch);
    }
    if (DRY || !room) continue;

    const res = await LmsLiveSession.updateMany(
      { batch: batchId, removed: { $ne: true }, status: { $in: ['scheduled', 'upcoming'] }, batchRoom: { $exists: false } },
      { $set: { batchRoom: room._id, roomName: room.roomName, publicKey: room.publicKey, updated: new Date() } }
    );
    stat.sessionsRepointed += res.modifiedCount || res.nModified || 0;
  }

  // ── 4 : old LiveClass.joinUrl pointing at a bearer-gated API URL ──────
  // Pre-fix rows had joinUrl = <crm>/api/lms/live-classes/:id/open, which a
  // plain browser click answers with raw {"jwtExpired":true}. Point them at
  // the in-app deep link instead (the Join button there is authenticated).
  let joinUrlFixed = 0;
  try {
    const LiveClass = mongoose.model('LiveClass');
    const bad = await LiveClass.find({ joinUrl: /\/api\/lms\//i, removed: { $ne: true } }, '_id joinUrl');
    joinUrlFixed = bad.length;
    if (!DRY && bad.length) {
      await LiveClass.updateMany(
        { _id: { $in: bad.map((x) => x._id) } },
        [{ $set: { joinUrl: { $concat: [{ $arrayElemAt: [{ $split: ['$joinUrl', '/api/lms/'] }, 0] }, '/#/lms/classes'] }, updated: new Date() } }]
      );
    }
  } catch (e) {
    /* LiveClass model optional */
  }

  console.log('LmsLiveSession scanned .............', stat.legacyScanned);
  console.log('  legacy docs normalised ..........', stat.legacyFixed);
  console.log('  missing LiveRecording rows added ', stat.recCreated);
  console.log('LmsBatchRoom created ..............', stat.batchRooms);
  console.log('  sessions re-pointed to batch room', stat.sessionsRepointed);
  console.log('LiveClass.joinUrl de-API-ified ....', joinUrlFixed);
  console.log(DRY ? '\nDRY RUN — nothing was written.' : '\nDone.');

  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error('\nMIGRATION FAILED:', e);
  process.exit(2);
});
