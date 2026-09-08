// GET /api/marketing-hub/compare?key=<leaf|master>&dimension=region|business|system
// Runs the leaf (or the master rollup) once per slice of the chosen dimension
// and returns them side by side for the comparison panel (spec §09/10/11).
const { LEAF_BY_KEY } = require('../../../config/marketingDashboards');
const { windowFromQuery } = require('../analyticsController/shared');
const { buildPremium } = require('./premium');

const DIMENSIONS = {
  region: { param: 'region', slices: [{ label: 'India', region: 'India' }, { label: 'USA', region: 'USA' }] },
  business: { param: 'businessType', slices: [{ label: 'B2B', businessType: 'B2B' }, { label: 'B2C', businessType: 'B2C' }] },
  system: {
    param: 'systemType',
    slices: [
      { label: 'Human System', systemType: 'Human' },
      { label: 'AI System', systemType: 'AI' },
      { label: 'Combined', systemType: undefined },
    ],
  },
};

module.exports = ({ computeFor, computeMaster }) => {
  const compare = async (req, res) => {
    const dim = DIMENSIONS[req.query.dimension || 'region'];
    if (!dim) return res.status(400).json({ success: false, result: null, message: 'Unknown dimension' });

    const key = req.query.key || 'master';
    const leaf = key === 'master' ? null : LEAF_BY_KEY[key];
    if (key !== 'master' && !leaf) {
      return res.status(404).json({ success: false, result: null, message: 'Unknown dashboard' });
    }
    const { from, to, prevFrom, prevTo } = windowFromQuery(req.query);

    const slices = await Promise.all(
      dim.slices.map(async (sl) => {
        const q = { ...req.query };
        Object.keys(dim.slices[0]).forEach((k) => k !== 'label' && delete q[k]);
        if (sl[dim.param] !== undefined) q[dim.param] = sl[dim.param];
        else delete q[dim.param];

        let payload;
        if (key === 'master') {
          payload = await computeMaster(q);
        } else {
          const [cur, prev] = await Promise.all([
            computeFor(leaf, q, from, to),
            computeFor(leaf, q, prevFrom, prevTo),
          ]);
          payload = buildPremium(leaf, cur, prev, from, to, { prevFrom, prevTo });
        }
        return {
          label: sl.label,
          kpis: payload.kpis,
          ratios: payload.ratios,
          funnel: payload.funnel,
          trend: (payload.charts && payload.charts.trend) || null,
        };
      })
    );

    return res.status(200).json({
      success: true,
      result: { key, dimension: req.query.dimension || 'region', range: { from, to }, slices },
      message: 'ok',
    });
  };

  return { compare };
};
