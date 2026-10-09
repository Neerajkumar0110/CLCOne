const mongoose = require('mongoose');
const Joi = require('joi');
const { resolveHierarchyScope } = require('../../../../services/access/salesHierarchy');

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// POST /api/performance/targets { admin, period?, targetCalls?, targetDeals?, targetRevenue? }
// Sets (upserts) one person's monthly target. Only allowed when `admin` is
// inside the requester's own sales-hierarchy scope (see
// services/access/salesHierarchy.js) — i.e. themselves, or someone reporting
// up to them through Admin.reportsTo, however many levels deep — or the
// requester is full-access (owner/Super Admin/Admin/Sales Manager).
const upsert = async (req, res) => {
  const schema = Joi.object({
    admin: Joi.string().required(),
    period: Joi.string().pattern(/^\d{4}-\d{2}$/),
    targetCalls: Joi.number().min(0).allow(null),
    targetDeals: Joi.number().min(0).allow(null),
    targetRevenue: Joi.number().min(0).allow(null),
  });
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(409).json({ success: false, result: null, message: error.message });
  }
  if (!mongoose.isValidObjectId(value.admin)) {
    return res.status(409).json({ success: false, result: null, message: 'Invalid admin id.' });
  }

  const Admin = mongoose.model('Admin');
  const target = await Admin.findOne({ _id: value.admin, removed: false }).select('name role').lean();
  if (!target) {
    return res.status(404).json({ success: false, result: null, message: 'User not found.' });
  }

  const hierarchy = await resolveHierarchyScope(req.admin);
  const inScope = hierarchy.isFullAccess || (hierarchy.names || []).includes(target.name);
  if (!inScope) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'You can only set targets for yourself or people in your reporting chain.',
    });
  }

  const period = value.period || currentPeriod();
  const Target = mongoose.model('Target');

  const result = await Target.findOneAndUpdate(
    { admin: value.admin, period },
    {
      $set: {
        admin: value.admin,
        adminName: target.name,
        period,
        ...(value.targetCalls !== undefined ? { targetCalls: value.targetCalls } : {}),
        ...(value.targetDeals !== undefined ? { targetDeals: value.targetDeals } : {}),
        ...(value.targetRevenue !== undefined ? { targetRevenue: value.targetRevenue } : {}),
        setBy: req.admin._id,
        setByName: req.admin.name,
        updated: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return res.status(200).json({ success: true, result, message: 'Target saved.' });
};

module.exports = upsert;
