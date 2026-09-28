const mongoose = require('mongoose');
const { getProvider, callingConfig } = require('../services/calling');

// Plivo's own recordingCallbackUrl push (see plivoAnswer.js's conferenceXml)
// never actually reached this server for any real call tested — the
// recordings genuinely exist on Plivo's side (confirmed against their
// Recording API) with the right duration, our CallRecord just never heard
// about it, so the Recordings list stayed stuck on "unavailable" forever.
// This periodically pulls the answer instead of waiting on that push:
// every completed cloud call from the last hour that isn't marked
// available yet gets one targeted Recording API lookup (see
// CloudCallProvider.syncRecording — exact conference_name match, no
// guessing). The read endpoints also do this on-demand for one call at a
// time; this is what fixes the list view without anyone opening each row.
const TICK_MS = 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 20;

function startCallingRecordingSync() {
  if (callingConfig.provider !== 'cloud') return;

  let running = false;
  let quietUntil = 0;
  setInterval(async () => {
    if (running) return;
    if (mongoose.connection.readyState !== 1) return;
    running = true;
    try {
      const CallRecord = mongoose.model('CallRecord');
      const pending = await CallRecord.find({
        removed: false,
        provider: 'cloud',
        status: 'completed',
        'recording.status': { $ne: 'available' },
        endedAt: { $gte: new Date(Date.now() - WINDOW_MS) },
      })
        .select('_id')
        .limit(BATCH_LIMIT)
        .lean();

      if (!pending.length) return;
      const provider = getProvider();
      for (const rec of pending) {
        await provider.syncRecording(rec).catch(() => {});
      }
    } catch (err) {
      if (Date.now() > quietUntil) {
        console.error('callingRecordingSync job error:', err.message);
        quietUntil = Date.now() + 60 * 1000;
      }
    } finally {
      running = false;
    }
  }, TICK_MS);
}

module.exports = startCallingRecordingSync;
