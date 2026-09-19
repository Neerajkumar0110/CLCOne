const { windowFromQuery } = require('./shared');

// One controller family for all 9 analytics dashboards. Each module file
// exports { summary({from,to,prevFrom,prevTo,query,req}) , rows?(...) } and
// returns the uniform payload documented in the plan.
const MODULES = {
  overview: require('./modules/overview'),
  leads: require('./modules/leads'),
  customers: require('./modules/customers'),
  interns: require('./modules/interns'),
  calls: require('./modules/calls'),
  deals: require('./modules/deals'),
  quotes: require('./modules/quotes'),
  orders: require('./modules/orders'),
  products: require('./modules/products'),
};

const summary = async (req, res) => {
  const mod = MODULES[req.params.module];
  if (!mod) {
    return res.status(404).json({ success: false, result: null, message: 'Unknown analytics module' });
  }
  const win = windowFromQuery(req.query);
  const result = await mod.summary({ ...win, query: req.query || {}, req });
  return res.status(200).json({ success: true, result, message: 'ok' });
};

const rows = async (req, res) => {
  const mod = MODULES[req.params.module];
  if (!mod || typeof mod.rows !== 'function') {
    return res
      .status(404)
      .json({ success: false, result: null, message: 'This module has no server-side rows endpoint' });
  }
  const win = windowFromQuery(req.query);
  const out = await mod.rows({ ...win, query: req.query || {}, req });
  return res.status(200).json({
    success: true,
    result: out.rows || [],
    pagination: out.pagination || { page: 1, pages: 1, count: (out.rows || []).length },
    message: 'ok',
  });
};

module.exports = { summary, rows };
