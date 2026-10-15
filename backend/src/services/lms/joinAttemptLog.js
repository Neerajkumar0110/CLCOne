const mongoose = require('mongoose');

// Records one live-class join step (models/appModels/lms/LmsJoinAttempt.js).
// Never throws and never delays the join — a logging failure must not stop
// anyone getting into class.
function recordJoinAttempt({ req, sessionId, user, step, via, ok, errorCode, error }) {
  Promise.resolve()
    .then(() =>
      mongoose.model('LmsJoinAttempt').create({
        session: mongoose.isValidObjectId(sessionId) ? sessionId : undefined,
        crmUser: user && user._id,
        email: user && user.email,
        name: user ? `${user.name || ''} ${user.surname || ''}`.trim() : undefined,
        step,
        via,
        ok: !!ok,
        errorCode: errorCode || undefined,
        error: error || undefined,
        ip: req ? String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() : undefined,
        userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 300) : undefined,
      })
    )
    .catch((e) => console.error('[lms] join attempt log failed:', e && e.message));
}

module.exports = { recordJoinAttempt };
