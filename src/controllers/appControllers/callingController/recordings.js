const mongoose = require('mongoose');
const { getProvider, callingConfig } = require('../../../services/calling');
const { buildHeaders } = require('../../../services/calling/httpSign');
const { callingTier, campaignScope } = require('./permissions');

// Authorise the current user to touch a given recording.
async function authorize(req, rec) {
  const tier = callingTier(req);
  if (tier === 'admin') return true;
  if (tier === 'manager') {
    const scope = await campaignScope(req);
    const camps = await mongoose
      .model('CallCampaign')
      .find({ removed: false, ...scope })
      .select('_id')
      .lean();
    return camps.some((c) => String(c._id) === String(rec.campaign));
  }
  return String(rec.agent) === String(req.admin._id);
}

// GET /api/calling/recordings?status=&campaign=&agent=&page=&items=
// Lists calls that have (or are producing) a recording. NEVER returns a
// real audio URL in mock mode.
const list = async (req, res) => {
  await getProvider().tick();
  const CallRecord = mongoose.model('CallRecord');
  const CallCampaign = mongoose.model('CallCampaign');
  const q = req.query;

  const page = parseInt(q.page) || 1;
  const items = Math.min(parseInt(q.items) || 20, 200);

  const filter = { removed: false, answeredAt: { $ne: null } };
  const tier = callingTier(req);
  if (tier === 'agent') filter.agent = req.admin._id;
  else if (tier === 'manager') {
    const scope = await campaignScope(req);
    const camps = await CallCampaign.find({ removed: false, ...scope }).select('_id').lean();
    filter.campaign = { $in: camps.map((c) => c._id) };
  }
  if (q.campaign) filter.campaign = q.campaign;
  if (q.agent) filter.agent = q.agent;
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
  if (!(await authorize(req, rec))) {
    return res.status(403).json({ success: false, result: null, message: 'Not authorised for this recording.' });
  }
  const info = await getProvider().getRecording(rec);
  return res.status(200).json({ success: true, result: info, message: 'ok' });
};

// GET /api/calling/recordings/:id/stream — the ONLY way to hear a
// recording. Authorises the caller, then (telephony mode) proxies the
// audio from the VPS with a signed request — the raw file directory is
// never public. Mock mode has no audio.
const stream = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({ _id: req.params.id, removed: false });
  if (!rec) return res.status(404).json({ success: false, message: 'Not found' });
  if (!(await authorize(req, rec))) {
    return res.status(403).json({ success: false, message: 'Not authorised for this recording.' });
  }
  if (callingConfig.provider !== 'telephony') {
    return res.status(404).json({ success: false, message: 'No audio in this mode.' });
  }
  const ref = rec.recording && rec.recording.reference;
  if (!ref || (rec.recording && rec.recording.status !== 'available')) {
    return res.status(409).json({ success: false, message: 'Recording not ready.' });
  }

  const t = callingConfig.telephony;
  const url = `${t.apiUrl.replace(/\/+$/, '')}/recordings/${encodeURIComponent(ref)}`;
  const { headers } = buildHeaders({ apiKey: t.apiKey, secret: t.hmacSecret, body: '' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const upstream = await fetch(url, { headers, signal: ctrl.signal });
    if (!upstream.ok) {
      return res.status(502).json({ success: false, message: `Recording service returned ${upstream.status}` });
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="call-${rec._id}.wav"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    // Node 18+ fetch body is a web ReadableStream.
    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(504).json({ success: false, message: `Recording proxy failed: ${err.message}` });
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { list, read, stream };
