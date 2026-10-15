const mongoose = require('mongoose');
const { notify } = require('../../../../notify');
const { resolveStageSub, stageConfig } = require('../../../../config/leadStages');
const { validateStageRules } = require('./stageValidation');
const { SALES_ROLES } = require('../../../../config/roles');

const Model = mongoose.model('Lead');

// Manual lead creation from the UI (POST /api/lead/create). Adds a team
// notification + validates the (stage, sub-status) pair and any date that
// stage makes mandatory. Bulk import + ad-platform webhooks write Lead
// docs directly and skip this.
const create = async (req, res) => {
  const b = req.body || {};
  b.removed = false;
  const allowDuplicate = !!b.allowDuplicate;
  delete b.allowDuplicate;

  // Basic shape — the Sales flow is phone-first (the Instant Lead Pool and
  // every dialer need a callable number), so a lead without one is useless.
  b.name = String(b.name || '').trim();
  b.phone = String(b.phone || '').trim();
  b.email = String(b.email || '').trim().toLowerCase();
  if (!b.name) return res.status(400).json({ success: false, result: null, message: 'Client name is required.' });
  const phoneDigits = b.phone.replace(/\D/g, '');
  if (phoneDigits.length < 10) {
    return res.status(400).json({ success: false, result: null, message: 'Enter a valid phone number (at least 10 digits).' });
  }
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) {
    return res.status(400).json({ success: false, result: null, message: 'Enter a valid email address.' });
  }
  if (!b.source) b.source = 'Manual';

  // Server-side duplicate check on the same last-10-digits key the model
  // stores (phoneNormalized). The UI shows the match and can resend with
  // allowDuplicate: true ("Add anyway").
  if (!allowDuplicate) {
    const dup = await Model.findOne({ removed: false, phoneNormalized: phoneDigits.slice(-10) })
      .select('name phone email stage subStatus assignedUserName team source created')
      .lean();
    if (dup) {
      return res.status(409).json({
        success: false,
        result: null,
        duplicate: dup,
        message: `A lead with this phone already exists (${dup.name}).`,
      });
    }
  }

  const r = resolveStageSub({ stage: b.stage, subStatus: b.subStatus, status: b.status });
  const ruleErr = validateStageRules(r.stage, r.subStatus, b);
  if (ruleErr) {
    return res.status(400).json({ success: false, result: null, message: ruleErr });
  }
  b.stage = r.stage;
  b.subStatus = r.subStatus;
  b.status = r.status;
  b.stageUpdatedAt = new Date();

  if (b.assignedUser) {
    const Admin = mongoose.model('Admin');
    const a = await Admin.findOne({ _id: b.assignedUser, removed: false }).select('name surname role enabled').lean();
    if (!a || !a.enabled || !SALES_ROLES.includes(a.role)) {
      return res.status(400).json({ success: false, result: null, message: 'Leads can only be assigned to an active Sales user.' });
    }
    b.assignedUserName = `${a.name} ${a.surname || ''}`.trim();
  } else {
    b.assignedUser = null;
  }

  const cfg = stageConfig(r.stage);
  if (r.stage === 'Enrolled' && !b.enrolledAt) b.enrolledAt = new Date();
  if (cfg && cfg.linkSubStatuses && cfg.linkSubStatuses.includes(r.subStatus) && b.registrationLink && !b.registrationLinkSharedAt) {
    b.registrationLinkSharedAt = new Date();
  }

  b.stageHistory = [
    {
      toStage: r.stage,
      toSubStatus: r.subStatus,
      changedBy: req.admin ? req.admin._id : undefined,
      changedByName: req.admin ? `${req.admin.name} ${req.admin.surname || ''}`.trim() : undefined,
      remarks: b.stageRemarks || 'Lead created',
      at: new Date(),
    },
  ];

  const result = await new Model({ ...b }).save();

  notify({
    audience: 'team',
    teamName: result.team,
    actorId: req.admin._id,
    actorName: req.admin.name,
    module: 'Leads',
    type: 'lead.created',
    title: `New lead: ${result.name}`,
    body: result.source ? `via ${result.source}` : undefined,
    link: '/leads',
  });

  return res.status(200).json({
    success: true,
    result,
    message: 'Lead added.',
  });
};

module.exports = create;
