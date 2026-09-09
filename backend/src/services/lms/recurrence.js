const crypto = require('crypto');
const mongoose = require('mongoose');
const { lmsConfig } = require('../../config/lms');

// Turn a batch's schedule (days + time + duration + start/end date) into a set
// of LmsLiveSession rows — one per class date, each with its own room. Used by
// Batch.js post-save and by an explicit "regenerate schedule" endpoint.
//
// Batch fields used (all optional; sensible fallbacks):
//   classDays        "Mon,Wed,Fri"   (or parsed from `schedule`)
//   classTime        "10:00"         (24h; or parsed from `schedule`)
//   classDurationMin  60             (or from `schedule`, else 60)
//   startDate / endDate
// If no endDate: MAX_AUTO_CLASSES sessions from startDate.

const MAX_AUTO_CLASSES = Number(process.env.LMS_MAX_AUTO_CLASSES || 60);
const DAY_IDX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseDays(batch) {
  const src = `${batch.classDays || ''} ${batch.schedule || ''}`.toLowerCase();
  const found = [];
  for (const [k, v] of Object.entries(DAY_IDX)) if (src.includes(k)) found.push(v);
  // "weekdays" / "daily" shortcuts
  if (!found.length && /weekday|mon.*fri/.test(src)) return [1, 2, 3, 4, 5];
  if (!found.length && /daily|every ?day/.test(src)) return [0, 1, 2, 3, 4, 5, 6];
  return [...new Set(found)].sort();
}

function parseTime(batch) {
  const src = `${batch.classTime || ''} ${batch.schedule || ''}`;
  const m = /(\d{1,2})[:.](\d{2})\s*(am|pm)?/i.exec(src);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return { h, min };
  }
  if (/morning/i.test(src)) return { h: 9, min: 0 };
  if (/afternoon/i.test(src)) return { h: 14, min: 0 };
  if (/evening/i.test(src)) return { h: 18, min: 0 };
  return { h: 10, min: 0 };
}

function parseDuration(batch) {
  if (batch.classDurationMin > 0) return batch.classDurationMin;
  const m = /(\d+)\s*(min|hour|hr)/i.exec(batch.schedule || '');
  if (m) return /hour|hr/i.test(m[2]) ? Number(m[1]) * 60 : Number(m[1]);
  // "10:00 - 11:00" style
  const r = /(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?/i.exec(batch.schedule || '');
  if (r) {
    const to24 = (h, ap) => (ap && ap.toLowerCase() === 'pm' && +h < 12 ? +h + 12 : ap && ap.toLowerCase() === 'am' && +h === 12 ? 0 : +h);
    const start = to24(r[1], r[3]) * 60 + +r[2];
    const end = to24(r[4], r[6]) * 60 + +r[5];
    if (end > start) return end - start;
  }
  return lmsConfig.meeting.defaultDurationMin || 60;
}

// Returns an array of { start: Date, end: Date, index: n }
function occurrences(batch) {
  const days = parseDays(batch);
  const { h, min } = parseTime(batch);
  const durMin = parseDuration(batch);

  const from = batch.startDate ? new Date(batch.startDate) : new Date();
  from.setHours(0, 0, 0, 0);
  const to = batch.endDate ? new Date(batch.endDate) : null;

  const out = [];
  const cursor = new Date(from);
  let guard = 0;
  while (guard++ < 400 && out.length < MAX_AUTO_CLASSES) {
    if (to && cursor > to) break;
    const isClassDay = days.length ? days.includes(cursor.getDay()) : out.length === 0; // no days -> single class
    if (isClassDay) {
      const start = new Date(cursor);
      start.setHours(h, min, 0, 0);
      if (!to || start <= new Date(to.getTime() + 86400000)) {
        out.push({ start, end: new Date(start.getTime() + durMin * 60000), index: out.length + 1, durMin });
      }
      if (!days.length) break; // single occurrence
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

// Generate the sessions for a batch. Returns the created rows.
//   onBatchCreated path: skip entirely if the batch already has sessions.
//   regenerate path ({ force:true }): gap-fill only — create a session for
//   each class date that has no live (non-removed) session yet; never touch
//   started / existing ones.
async function generateForBatch(batchDoc, liveClassService, { force = false } = {}) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  if (!batchDoc || batchDoc.removed) return [];

  const existingRows = await LmsLiveSession.find({ batch: batchDoc._id, removed: false }, 'scheduledStart recurrenceGroup').lean();
  if (existingRows.length > 0 && !force) return []; // already generated

  // dates that already have a live session (±90s) — skip those in force mode
  const taken = existingRows.map((r) => +new Date(r.scheduledStart));
  const alreadyHas = (d) => taken.some((t) => Math.abs(t - +d) < 90000);

  const Course = mongoose.model('Course');
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  const Admin = mongoose.model('Admin');

  const course = batchDoc.course ? await Course.findOne({ title: batchDoc.course, removed: false }) : null;
  const courseMap = course ? await MoodleObjectMap.findOne({ kind: 'course', crmId: course._id }) : null;
  const teacher = batchDoc.trainer
    ? await Admin.findOne({ name: new RegExp(`^${String(batchDoc.trainer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), removed: false })
    : null;

  const occ = occurrences(batchDoc);
  const group =
    (existingRows.find((r) => r.recurrenceGroup) || {}).recurrenceGroup || crypto.randomBytes(8).toString('hex');
  const created = [];
  for (const o of occ) {
    if (force && alreadyHas(o.start)) continue;
    const s = await liveClassService.createSession({
      crmCourse: course ? course._id : undefined,
      batch: batchDoc._id,
      moodleCourseId: courseMap ? courseMap.moodleId : undefined,
      courseTitle: batchDoc.course || (course && course.title) || '',
      batchName: batchDoc.name,
      teacherName: batchDoc.trainer || '',
      teacherCrmUser: teacher ? teacher._id : undefined,
      title: occ.length > 1 ? `${batchDoc.name} — Class ${o.index}` : `${batchDoc.name} — Live Class`,
      description: batchDoc.notes || '',
      scheduledStart: o.start,
      scheduledEnd: o.end,
      scheduledDurationMin: o.durMin,
      recurrenceGroup: group,
      sessionIndex: o.index,
      autoCreated: true,
    });
    created.push(s);
  }
  return created;
}

module.exports = { generateForBatch, occurrences, parseDays, parseTime, parseDuration };
