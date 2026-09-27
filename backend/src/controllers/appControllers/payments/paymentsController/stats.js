const mongoose = require('mongoose');
const { resolveScope } = require('../../../../services/access/salesScope');

const DAY = 86400000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// { today, week (7d), month (30d), threeMonth (90d), sixMonth (180d) } —
// each a { count, amount } of PAID payment requests (by paidAt) whose
// createdByName is in `names`.
async function windowStats(PaymentRequest, names) {
  if (!names || names.length === 0) {
    return {
      today: { count: 0, amount: 0 },
      week: { count: 0, amount: 0 },
      month: { count: 0, amount: 0 },
      threeMonth: { count: 0, amount: 0 },
      sixMonth: { count: 0, amount: 0 },
    };
  }

  const now = Date.now();
  const windows = {
    today: startOfToday(),
    week: new Date(now - 7 * DAY),
    month: new Date(now - 30 * DAY),
    threeMonth: new Date(now - 90 * DAY),
    sixMonth: new Date(now - 180 * DAY),
  };

  // One query per window (5 total) rather than fetching 6 months of rows and
  // bucketing in JS — payment requests are small individually but this
  // keeps it correct without worrying about the list endpoint's 2000-row cap.
  const entries = await Promise.all(
    Object.entries(windows).map(async ([key, since]) => {
      const rows = await PaymentRequest.aggregate([
        { $match: { removed: false, status: 'paid', createdByName: { $in: names }, paidAt: { $gte: since } } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]);
      const row = rows[0] || { count: 0, amount: 0 };
      return [key, { count: row.count, amount: row.amount }];
    })
  );

  return Object.fromEntries(entries);
}

// GET /api/payments/stats — "how much have I/my team brought in" broken down
// by Today / This Week / This Month / 3 Months / 6 Months. Powers the
// Payments page's "Me" / "My Team" toggle — never anyone else's individual
// numbers, same row-level rule as list.js (see scope.js).
async function stats(req, res) {
  const PaymentRequest = mongoose.model('PaymentRequest');
  const { isFullAccess, teamMemberNames, teamName } = await resolveScope(req.admin);

  const selfNames = [req.admin.name];
  const self = await windowStats(PaymentRequest, selfNames);

  // "Team" is null when the caller isn't on a team at all (nothing to show
  // beyond their own numbers) — full-access callers aren't forced onto a
  // team either, so this is the same "self or team, never automatic" shape
  // as everywhere else, just also exposed to management if they happen to
  // be on one.
  let team = null;
  if (teamMemberNames && teamMemberNames.length > 1) {
    team = { name: teamName, ...(await windowStats(PaymentRequest, teamMemberNames)) };
  }

  return res.status(200).json({
    success: true,
    result: { isFullAccess, self, team },
    message: 'Successfully computed payment stats',
  });
}

module.exports = stats;
