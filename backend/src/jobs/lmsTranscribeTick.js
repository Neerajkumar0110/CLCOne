const transcriber = require('../services/lms/transcriber');

// Recorded-class transcripts (services/lms/transcriber.js) — checks every
// 2 minutes: start the next queued recording in the night window, or pause
// the running one the moment a class goes live. No-op where Whisper isn't
// installed (laptop backend, Vercel).
const TICK_MS = Number(process.env.LMS_TRANSCRIBE_TICK_MS || 2 * 60 * 1000);

module.exports = function startLmsTranscribeTick() {
  if (!transcriber.enabled()) return;
  setTimeout(() => {
    transcriber
      .recoverOnBoot()
      .then(() => transcriber.tick())
      .catch(() => {});
  }, 30 * 1000);
  setInterval(() => transcriber.tick().catch(() => {}), TICK_MS);
};
