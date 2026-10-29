const mongoose = require('mongoose');

// GET /api/facebook/captured-leads?range=today|yesterday|7d|15d|30d|all&page=&items=
// Capture Form → Facebook Ads → "Captured Leads from Facebook Ads": every
// lead that came from a Facebook Lead Ad form — new ones the poller/webhook
// created AND existing CRM leads a Facebook submission was linked to (same
// phone, e.g. an earlier Excel import) — newest Facebook submission first.
// The range is in IST, on when the person submitted the form.
const IST_MS = 5.5 * 60 * 60 * 1000;
const DAY = 86400000;

function rangeBounds(range) {
  const now = Date.now();
  const istMidnight = Math.floor((now + IST_MS) / DAY) * DAY - IST_MS; // today 00:00 IST, as UTC ms
  switch (range) {
    case 'today':
      return { from: new Date(istMidnight) };
    case 'yesterday':
      return { from: new Date(istMidnight - DAY), to: new Date(istMidnight) };
    case '7d':
      return { from: new Date(istMidnight - 6 * DAY) };
    case '15d':
      return { from: new Date(istMidnight - 14 * DAY) };
    case '30d':
      return { from: new Date(istMidnight - 29 * DAY) };
    default:
      return {};
  }
}

const tail = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Numbers a user has actually spoken to (answered call taken by an agent).
// Cached briefly — the page polls every 30s and this scans every call.
let _spoken = { at: 0, tails: [] };
async function spokenPhoneTails(CallRecord) {
  if (Date.now() - _spoken.at < 20000) return _spoken.tails;
  const phones = await CallRecord.distinct('phone', { removed: { $ne: true }, answeredAt: { $ne: null }, agent: { $ne: null } });
  _spoken = { at: Date.now(), tails: [...new Set(phones.map(tail).filter((t) => t.length === 10))] };
  return _spoken.tails;
}

const capturedLeads = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const items = Math.min(100, Math.max(1, parseInt(req.query.items, 10) || 10));
  const range = String(req.query.range || 'all');

  const { from, to } = rangeBounds(range);
  // Facebook's own submit time; leads saved before that field existed fall
  // back to when the CRM created them.
  const when = from || to ? { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) } : null;
  const filter = {
    removed: false,
    facebookLeadId: { $exists: true, $ne: null },
    ...(when
      ? { $or: [{ facebookCreatedAt: when }, { facebookCreatedAt: { $exists: false }, created: when }] }
      : {}),
  };

  // "Contacted" = a user actually spoke to this number (an answered call
  // that an agent took). ?contact=yes|no narrows the list to either side.
  const CallRecord = mongoose.model('CallRecord');
  const spokenTails = await spokenPhoneTails(CallRecord);
  const contact = String(req.query.contact || 'all');
  const listFilter =
    contact === 'yes'
      ? { $and: [filter, { phoneNormalized: { $in: spokenTails } }] }
      : contact === 'no'
        ? { $and: [filter, { phoneNormalized: { $nin: spokenTails } }] }
        : filter;

  const [rows, count, total, contactedCount] = await Promise.all([
    Lead.find(listFilter)
      .sort({ facebookCreatedAt: -1, created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      // the whole lead (the row opens LeadDetailModal) minus the heavy bits
      .select('-rawMetaData -stageHistory -callHistory')
      .lean(),
    Lead.countDocuments(listFilter),
    Lead.countDocuments(filter),
    Lead.countDocuments({ $and: [filter, { phoneNormalized: { $in: spokenTails } }] }),
  ]);

  // Every call to this page's numbers: who spoke to them, and how many tries.
  const tails = [...new Set(rows.map((l) => l.phoneNormalized || tail(l.phone)).filter((t) => t.length === 10))];
  const calls = tails.length
    ? await CallRecord.find({ removed: { $ne: true }, phone: { $regex: `(${tails.join('|')})$` } })
        .select('phone agentName ownerAgentName status answeredAt duration created direction agent')
        .sort({ created: -1 })
        .lean()
    : [];
  const byTail = new Map();
  calls.forEach((c) => {
    const t = tail(c.phone);
    if (!byTail.has(t)) byTail.set(t, []);
    byTail.get(t).push(c);
  });
  const callSummary = (l) => {
    const list = byTail.get(l.phoneNormalized || tail(l.phone)) || [];
    const spoke = list.find((c) => c.answeredAt && c.agent);
    const last = list[0];
    return {
      attempts: list.length,
      contacted: !!spoke,
      spokeWith: spoke ? { name: spoke.agentName || '—', at: spoke.answeredAt, durationSec: spoke.duration || 0, direction: spoke.direction } : null,
      lastCall: last ? { name: last.agentName || last.ownerAgentName || null, at: last.created, status: last.status } : null,
    };
  };

  return res.status(200).json({
    success: true,
    result: rows.map((l) => {
      const calls = callSummary(l);
      return {
        ...l,
        // 'Facebook Ads' = created from Facebook; anything else = it was
        // already in the CRM (e.g. Import) and the submission was linked.
        newFromFacebook: l.source === 'Facebook Ads',
        // the last time a user actually spoke to them, when not recorded on the lead
        lastContactAt: l.lastContactAt || (calls.spokeWith ? calls.spokeWith.at : undefined),
        calls,
      };
    }),
    pagination: { page, pages: Math.max(1, Math.ceil(count / items)), count },
    summary: { total, contacted: contactedCount, notContacted: total - contactedCount },
    message: 'ok',
  });
};

module.exports = capturedLeads;
