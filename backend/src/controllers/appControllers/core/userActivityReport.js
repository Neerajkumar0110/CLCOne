const ua = require('../../../services/reports/userActivity');
const { renderUserPdf, renderAllPdf } = require('../../../services/reports/userActivityPdf');

// Advanced Reporting → "User Activity". Everyone can open it; what they see
// is scoped by services/reports/userActivity.js visibleUsers (management:
// every staff account, leads: their reporting line, others: themselves).
//   GET /api/reports/user-activity/users
//   GET /api/reports/user-activity?user=all|<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
//   GET /api/reports/user-activity/pdf?user=…&from=…&to=…

const users = async (req, res) => {
  const list = await ua.visibleUsers(req.admin);
  return res.status(200).json({
    success: true,
    result: list.map((u) => ({
      id: String(u._id),
      name: `${u.name || ''} ${u.surname || ''}`.trim(),
      role: u.role,
      deleted: !!u.removed,
      enabled: u.enabled !== false,
    })),
    message: 'ok',
  });
};

const isAll = (q) => !q.user || q.user === 'all';

const report = async (req, res) => {
  if (isAll(req.query)) {
    return res.status(200).json({ success: true, result: { kind: 'all', ...(await ua.buildAll(req.admin, req.query)) }, message: 'ok' });
  }
  const one = await ua.buildOne(req.admin, req.query.user, req.query);
  if (!one) return res.status(404).json({ success: false, result: null, message: 'User not found or not in your scope.' });
  return res.status(200).json({ success: true, result: { kind: 'one', ...one }, message: 'ok' });
};

const slug = (s) => String(s || 'report').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';

const pdf = async (req, res) => {
  let doc;
  let name;
  if (isAll(req.query)) {
    const all = await ua.buildAll(req.admin, req.query);
    // Full detail for everyone who actually did something (capped so a
    // year-long team PDF stays a sane size).
    const active = all.rows.filter((r) => r.calls || r.stageMoves || r.poolOns || r.paidCount).slice(0, 40);
    const details = [];
    for (const r of active) {
      const d = await ua.buildOne(req.admin, r.id, req.query);
      if (d) details.push(d);
    }
    doc = renderAllPdf(all, details);
    name = `Team-Activity_${all.range.from}_to_${all.range.to}.pdf`;
  } else {
    const one = await ua.buildOne(req.admin, req.query.user, req.query);
    if (!one) return res.status(404).json({ success: false, result: null, message: 'User not found or not in your scope.' });
    doc = renderUserPdf(one);
    name = `${slug(one.profile.name)}_Activity_${one.range.from}_to_${one.range.to}.pdf`;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  doc.pipe(res);
};

module.exports = { users, report, pdf };
