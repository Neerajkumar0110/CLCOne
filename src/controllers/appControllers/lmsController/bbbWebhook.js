const crypto = require('crypto');
const mongoose = require('mongoose');
const { lmsConfig, liveClassService, getMeetingProvider } = require('../../../services/lms');

// POST /api/lms/webhooks/bbb — BigBlueButton event callbacks (from the
// `bbb-webhooks` module on the BBB server). Not CRM-bearer-authed:
//   • a shared token in ?token= (LMS_BBB_WEBHOOK_TOKEN), AND/OR
//   • BBB's own checksum (verified via the provider + BBB_SECRET).
// Idempotent (per-event id remembered on the session), retry-safe, logged.
//
// Mounted BEFORE the bearer gate in app.js.

const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = k.split('.').reduce((a, kk) => (a && a[kk] !== undefined ? a[kk] : undefined), o);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

// BBB event name -> our normalized type
function normalizeType(name) {
  const n = String(name || '').toLowerCase();
  if (/meeting.?(created|started)/.test(n)) return 'meeting-started';
  if (/meeting.?ended/.test(n)) return 'meeting-ended';
  if (/user.?joined/.test(n)) return 'user-joined';
  if (/user.?left/.test(n)) return 'user-left';
  if (/(disconnect)/.test(n)) return 'participant-disconnected';
  if (/rap.?(publish.?ended|published)|recording.?(ready|published)/.test(n)) return 'recording-ready';
  if (/rap.?(process|publish).?started|recording.?processing/.test(n)) return 'recording-processing';
  if (/rap.?(unpublished|deleted)|recording.?deleted/.test(n)) return 'recording-deleted';
  if (/(rap.?process.?ended.*fail|recording.?failed|meeting.?error|error)/.test(n)) return 'meeting-error';
  return n;
}

function extractEvents(body) {
  // bbb-webhooks posts { event: "<json>" , timestamp, domain } — event may be
  // a JSON string, an object, or an array of {data:{...}}.
  let ev = body.event;
  if (typeof ev === 'string') {
    try {
      ev = JSON.parse(ev);
    } catch (e) {
      ev = null;
    }
  }
  if (!ev) ev = body;
  const arr = Array.isArray(ev) ? ev : [ev];
  return arr.map((item) => {
    const data = item.data || item;
    const attrs = data.attributes || data;
    const evName = pick(data, 'id', 'name') || pick(attrs, 'event.name') || pick(item, 'name');
    const meetingId =
      pick(attrs, 'meeting.external-meeting-id', 'meeting.externalMeetingID', 'meeting.external_meeting_id') ||
      pick(attrs, 'meeting.id', 'externalMeetingID', 'meetingId', 'meetingID') ||
      pick(data, 'externalMeetingID', 'meetingId');
    const user = attrs.user || attrs.User || {};
    return {
      id:
        pick(data, 'id') && pick(attrs, 'event.ts')
          ? `${pick(data, 'id')}:${pick(attrs, 'event.ts')}:${pick(user, 'internal-user-id', 'internalUserID', 'id') || ''}`
          : pick(item, 'id') || `${evName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      type: normalizeType(evName),
      meetingId,
      userId: pick(user, 'internal-user-id', 'internalUserID', 'id', 'userid'),
      crmUserId: pick(user, 'external-user-id', 'externalUserID', 'extId', 'external_user_id'),
      userName: pick(user, 'name', 'fullName'),
      role: pick(user, 'role', 'Role'),
      recordId: pick(attrs, 'recording.id', 'recordID', 'recordId'),
      playbackUrl: pick(attrs, 'recording.playback.link', 'playback.link', 'playbackUrl'),
      durationMin: (() => {
        const s = Number(pick(attrs, 'recording.startTime', 'recording.start_time'));
        const e = Number(pick(attrs, 'recording.endTime', 'recording.end_time'));
        return s && e ? Math.round((e - s) / 60000) : undefined;
      })(),
      reason: pick(attrs, 'reason', 'error'),
      at: Number(pick(attrs, 'event.ts')) ? new Date(Number(pick(attrs, 'event.ts'))) : new Date(),
    };
  });
}

async function log(entry) {
  try {
    const LmsWebhookEvent = mongoose.model('LmsWebhookEvent');
    await LmsWebhookEvent.create({
      eventId: entry.id,
      eventName: `bbb:${entry.type}`,
      payload: entry,
      status: entry.status || 'processed',
      processedAt: new Date(),
    });
  } catch (e) {
    // unique-key clash == duplicate delivery; that's fine
  }
}

async function receive(req, res) {
  // auth: shared token and/or BBB checksum
  const token = req.query.token || req.get('x-bbb-token');
  const expected = lmsConfig.bbb.webhookToken;
  const checksum = req.query.checksum || (req.body && req.body.checksum);
  let ok = false;
  if (expected && token && crypto.timingSafeEqual(Buffer.from(String(token)), Buffer.from(String(expected)))) ok = true;
  if (!ok && checksum && getMeetingProvider().name === 'bigbluebutton') {
    ok = getMeetingProvider().verifyWebhook(req.rawBody || JSON.stringify(req.body || {}), checksum);
  }
  if (!expected && !checksum) ok = true; // nothing configured to check against (dev)
  if (!ok) return res.status(401).json({ success: false, message: 'unauthorized webhook' });

  const events = extractEvents(req.body || {});
  const results = [];
  for (const evt of events) {
    if (!evt.meetingId) {
      await log({ ...evt, status: 'skipped' });
      results.push({ type: evt.type, skipped: 'no meetingId' });
      continue;
    }
    try {
      const r = await liveClassService.handleBbbEvent(evt);
      await log({ ...evt, status: r && r.duplicate ? 'skipped' : 'processed' });
      results.push({ type: evt.type, ...r });
    } catch (e) {
      await log({ ...evt, status: 'failed' });
      results.push({ type: evt.type, error: e.message });
    }
  }
  // BBB expects a 200 quickly
  return res.status(200).json({ success: true, processed: results.length, results });
}

module.exports = { receive, extractEvents, normalizeType };
