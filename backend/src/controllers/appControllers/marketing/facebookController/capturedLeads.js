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

  const [rows, count] = await Promise.all([
    Lead.find(filter)
      .sort({ facebookCreatedAt: -1, created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .select('name email phone stage subStatus status source assignedUserName metaFormName metaFormId facebookCreatedAt created')
      .lean(),
    Lead.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    result: rows.map((l) => ({
      ...l,
      // 'Facebook Ads' = created from Facebook; anything else = it was
      // already in the CRM (e.g. Import) and the submission was linked.
      newFromFacebook: l.source === 'Facebook Ads',
    })),
    pagination: { page, pages: Math.max(1, Math.ceil(count / items)), count },
    message: 'ok',
  });
};

module.exports = capturedLeads;
