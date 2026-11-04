const mongoose = require('mongoose');
const Joi = require('joi');
const { resolveHierarchyScope } = require('../../../../services/access/salesHierarchy');
const { MANAGEMENT_ROLES } = require('../../../../config/roles');

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
    targetProspects: Joi.number().min(0).allow(null),
    targetProspectsReason: Joi.string().allow('').max(500),
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
  // A Team Leader with no team yet can SEE everyone, but sets targets only
  // once they have a team.
  const inScope = (hierarchy.isFullAccess && !hierarchy.leaderOpen) || (hierarchy.names || []).includes(target.name);
  if (!inScope) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'You can only set targets for yourself or people in your reporting chain.',
    });
  }

  const period = value.period || currentPeriod();
  const Target = mongoose.model('Target');

  // CLC-POL-001 section 7: the Sales Manager sets the prospect target, and a
  // change to one already set is documented.
  let prospectChange = null;
  if (value.targetProspects !== undefined) {
    if (!MANAGEMENT_ROLES.includes(req.admin.role)) {
      return res.status(403).json({ success: false, result: null, message: 'Only the Sales Manager can set a prospect target.' });
    }
    const old = await Target.findOne({ admin: value.admin, period }).select('targetProspects').lean();
    const from = old && old.targetProspects != null ? old.targetProspects : null;
    if (from !== value.targetProspects) {
      const reason = String(value.targetProspectsReason || '').trim();
      if (from != null && reason.length < 5) {
        return res.status(400).json({ success: false, result: null, message: 'Write why this target is changing.' });
      }
      prospectChange = { from, to: value.targetProspects, reason, byName: req.admin.name, at: new Date() };
    }
  }

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
        ...(value.targetProspects !== undefined ? { targetProspects: value.targetProspects } : {}),
        setBy: req.admin._id,
        setByName: req.admin.name,
        updated: new Date(),
      },
      ...(prospectChange ? { $push: { targetProspectsHistory: prospectChange } } : {}),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  // Section 4: the target and how it is measured reach the person in writing.
  if (prospectChange && prospectChange.to != null) {
    require('../../../../notify').notifyUser({
      recipient: value.admin,
      actorId: req.admin._id,
      actorName: req.admin.name,
      module: 'Sales',
      type: 'target.prospects',
      title: `Your prospect target for ${period}: ${prospectChange.to}`,
      body: 'Measured by prospects a Team Leader has verified in the calendar month. Anything left carries into your backlog.',
      link: '/sales',
    });
  }

  return res.status(200).json({ success: true, result, message: 'Target saved.' });
};

module.exports = upsert;
