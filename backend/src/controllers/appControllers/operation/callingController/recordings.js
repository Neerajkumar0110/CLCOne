const mongoose = require('mongoose');
const { getProvider, callingConfig } = require('../../../../services/calling');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');

// Recording visibility: owner/Super Admin/Admin/Sales Manager/Team Manager
// (FULL_ACCESS_ROLES) hear every recording; everyone below them hears only
// their own calls. Deliberately NOT the calling tiers' campaign scope —
// nearly every call runs through the shared Instant Lead Pool campaign, so
// campaign-scoping let Team Leaders/Senior Executives/Support hear almost
// everyone's recordings.
const seesAllRecordings = (req) => FULL_ACCESS_ROLES.includes(req.admin && req.admin.role);

// Authorise the current user to touch a given recording.
function authorize(req, rec) {
  return seesAllRecordings(req) || String(rec.agent) === String(req.admin._id);
}

// GET /api/calling/recordings?status=&campaign=&agent=&page=&items=
// Lists calls that have (or are producing) a recording. NEVER returns a
// real audio URL in mock mode.
const list = async (req, res) => {
  await getProvider().tick();
  const CallRecord = mongoose.model('CallRecord');
  const q = req.query;

  const page = parseInt(q.page) || 1;
  const items = Math.min(parseInt(q.items) || 20, 200);

  const filter = { removed: false, answeredAt: { $ne: null } };
  if (q.campaign) filter.campaign = q.campaign;
  // `?agent=` only narrows a see-all caller's view — it must never widen
  // anyone else's past their own calls.
  if (seesAllRecordings(req)) {
    if (q.agent) filter.agent = q.agent;
  } else {
    filter.agent = req.admin._id;
  }
  if (q.status && q.status !== 'All') filter['recording.status'] = q.status;

  const [rows, count] = await Promise.all([
    CallRecord.find(filter)
      .sort({ endedAt: -1, created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .populate('campaign', 'name')
      .lean(),
    CallRecord.countDocuments(filter),
  ]);

  const result = rows.map((r) => ({
    _id: r._id,
    contactName: r.contactName,
    phone: r.phone,
    agentName: r.agentName,
    campaign: r.campaign && r.campaign.name,
    at: r.endedAt || r.created,
    durationSec: (r.recording && r.recording.durationSec) || r.duration || 0,
    recordingStatus: (r.recording && r.recording.status) || 'unavailable',
    // url intentionally omitted — served (guarded) via /recordings/:id only.
  }));

  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
};

// GET /api/calling/recordings/:id — recording metadata (no audio bytes).
const read = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({ _id: req.params.id, removed: false });
  if (!rec) return res.status(404).json({ success: false, result: null, message: 'Not found' });
  if (!authorize(req, rec)) {
    return res.status(403).json({ success: false, result: null, message: 'Not authorised for this recording.' });
  }
  const info = await getProvider().getRecording(rec);
  return res.status(200).json({ success: true, result: info, message: 'ok' });
};

// GET /api/calling/recordings/:id/stream — the ONLY way to hear a
// recording. Authorises the caller, then redirects to Plivo's own
// provider-hosted recording URL (from the call-status webhook). Mock
// mode has no audio.
const stream = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({ _id: req.params.id, removed: false });
  if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
  if (!authorize(req, rec)) {
    return res.status(403).json({ success: false, message: 'Not authorised for this recording.' });
  }
  if (callingConfig.provider !== 'cloud') {
    return res.status(404).json({ success: false, message: 'No audio in this mode.' });
  }
  if (!rec.recording || rec.recording.status !== 'available' || !rec.recording.url) {
    return res.status(409).json({ success: false, message: 'Recording not ready.' });
  }
  return res.redirect(302, rec.recording.url);
};

module.exports = { list, read, stream };
