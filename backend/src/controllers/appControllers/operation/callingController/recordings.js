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

// Authorise the current user to touch a given recording — their own calls
// include ones filed under them because no agent took it (ownerAgent).
function authorize(req, rec) {
  const me = String(req.admin._id);
  return seesAllRecordings(req) || String(rec.agent) === me || (!rec.agent && String(rec.ownerAgent) === me);
}
// "This user's calls": ones they took, plus ones nobody took that are theirs.
const callsOf = (id) => ({ $or: [{ agent: id }, { agent: null, ownerAgent: id }] });

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const GENERIC_NAMES = ['', 'Inbound caller', 'Unknown', 'Unknown Number'];

// GET /api/calling/recordings — Recording management.
//   q        name (contact / lead / user) or number
//   agent    a user's calls (taken by them, or filed under them)
//   direction Inbound|Outbound, status available|processing|unavailable,
//   campaign, from, to (ISO), page, items
// Returns the page of rows plus `summary` (KPIs + per-user breakdown) over
// the same filters minus `status`, so the status tiles can show the split.
// NEVER returns a real audio URL — that's /recordings/:id only.
const list = async (req, res) => {
  await getProvider().tick();
  const CallRecord = mongoose.model('CallRecord');
  const q = req.query;
  const seesAll = seesAllRecordings(req);

  const page = parseInt(q.page) || 1;
  const items = Math.min(parseInt(q.items) || 20, 200);

  const and = [{ removed: false, answeredAt: { $ne: null } }];
  if (q.campaign && mongoose.isValidObjectId(q.campaign)) and.push({ campaign: new mongoose.Types.ObjectId(q.campaign) });
  // `?agent=` only narrows a see-all caller's view — it must never widen
  // anyone else's past their own calls.
  if (seesAll) {
    if (q.agent && mongoose.isValidObjectId(q.agent)) and.push(callsOf(new mongoose.Types.ObjectId(q.agent)));
  } else {
    and.push(callsOf(req.admin._id));
  }
  if (['Inbound', 'Outbound'].includes(q.direction)) and.push({ direction: q.direction });
  if (q.from || q.to) {
    const created = {};
    if (q.from) created.$gte = new Date(q.from);
    if (q.to) created.$lte = new Date(q.to);
    and.push({ created });
  }
  const search = String(q.q || '').trim();
  if (search) {
    const rx = new RegExp(escapeRx(search), 'i');
    const or = [{ contactName: rx }, { agentName: rx }, { ownerAgentName: rx }];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ phone: new RegExp(escapeRx(digits)) });
    // Lead names too — most inbound / pool calls carry no contact name.
    const leads = await mongoose.model('Lead').find({ removed: false, name: rx }).select('phoneNormalized').limit(300).lean();
    const tails = [...new Set(leads.map((l) => l.phoneNormalized).filter((p) => p && p.length === 10))];
    if (tails.length) or.push({ phone: new RegExp(`(${tails.join('|')})$`) });
    and.push({ $or: or });
  }
  const base = { $and: and };
  const filter = q.status && q.status !== 'All' ? { $and: [...and, { 'recording.status': q.status }] } : base;

  const [rows, count, facets] = await Promise.all([
    CallRecord.find(filter)
      .sort({ endedAt: -1, created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .populate('campaign', 'name')
      .lean(),
    CallRecord.countDocuments(filter),
    CallRecord.aggregate([
      { $match: base },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                calls: { $sum: 1 },
                available: { $sum: { $cond: [{ $eq: ['$recording.status', 'available'] }, 1, 0] } },
                processing: { $sum: { $cond: [{ $eq: ['$recording.status', 'processing'] }, 1, 0] } },
                inbound: { $sum: { $cond: [{ $eq: ['$direction', 'Inbound'] }, 1, 0] } },
                notPicked: { $sum: { $cond: [{ $not: ['$agent'] }, 1, 0] } }, // nobody took it
                recordedSec: { $sum: { $cond: [{ $eq: ['$recording.status', 'available'] }, { $ifNull: ['$recording.durationSec', 0] }, 0] } },
                talkSec: { $sum: { $ifNull: ['$duration', 0] } },
              },
            },
          ],
          byUser: [
            {
              $group: {
                _id: { $ifNull: ['$agent', '$ownerAgent'] },
                name: { $first: { $ifNull: ['$agentName', '$ownerAgentName'] } },
                calls: { $sum: 1 },
                available: { $sum: { $cond: [{ $eq: ['$recording.status', 'available'] }, 1, 0] } },
                recordedSec: { $sum: { $cond: [{ $eq: ['$recording.status', 'available'] }, { $ifNull: ['$recording.durationSec', 0] }, 0] } },
                last: { $max: '$created' },
              },
            },
            { $sort: { calls: -1 } },
            { $limit: 50 },
          ],
        },
      },
    ]),
  ]);

  // Name the contact from the lead when the call itself has none.
  const needName = rows.filter((r) => GENERIC_NAMES.includes(r.contactName || '')).map((r) => last10(r.phone)).filter(Boolean);
  const leadName = new Map();
  if (needName.length) {
    const leads = await mongoose.model('Lead').find({ removed: false, phoneNormalized: { $in: [...new Set(needName)] } }).select('name phoneNormalized').lean();
    for (const l of leads) if (l.name) leadName.set(l.phoneNormalized, l.name);
  }

  const result = rows.map((r) => ({
    _id: r._id,
    contactName: GENERIC_NAMES.includes(r.contactName || '') ? leadName.get(last10(r.phone)) || r.contactName || null : r.contactName,
    phone: r.phone,
    direction: r.direction,
    agentName: r.agentName || r.ownerAgentName || null,
    // true = nobody took this call; agentName is the user it's filed under.
    ownerOnly: !r.agent && !!r.ownerAgent,
    campaign: r.campaign && r.campaign.name,
    disposition: r.disposition || null,
    at: r.endedAt || r.created,
    durationSec: (r.recording && r.recording.durationSec) || r.duration || 0,
    recordingStatus: (r.recording && r.recording.status) || 'unavailable',
    // url intentionally omitted — served (guarded) via /recordings/:id only.
  }));

  const t = (facets[0] && facets[0].totals[0]) || { calls: 0, available: 0, processing: 0, inbound: 0, notPicked: 0, recordedSec: 0, talkSec: 0 };
  const summary = {
    calls: t.calls,
    available: t.available,
    processing: t.processing,
    unavailable: t.calls - t.available - t.processing,
    coverage: t.calls ? Math.round((t.available / t.calls) * 1000) / 10 : 0,
    inbound: t.inbound,
    outbound: t.calls - t.inbound,
    notPicked: t.notPicked,
    recordedSec: t.recordedSec,
    avgRecordedSec: t.available ? Math.round(t.recordedSec / t.available) : 0,
    byUser: seesAll
      ? ((facets[0] && facets[0].byUser) || []).map((u) => ({
          userId: u._id,
          name: u._id ? u.name || '—' : 'No user',
          calls: u.calls,
          available: u.available,
          coverage: u.calls ? Math.round((u.available / u.calls) * 100) : 0,
          recordedSec: u.recordedSec,
          last: u.last,
        }))
      : [],
  };

  return res.status(200).json({
    success: true,
    result,
    summary,
    seesAll,
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
