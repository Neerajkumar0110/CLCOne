const mongoose = require('mongoose');
const { notify } = require('../../../notify');
const { resolveStageSub, stageConfig } = require('../../../config/leadStages');
const { validateStageRules } = require('./stageValidation');

const Model = mongoose.model('Lead');

// Manual lead creation from the UI (POST /api/lead/create). Adds a team
// notification + validates the (stage, sub-status) pair and any date that
// stage makes mandatory. Bulk import + ad-platform webhooks write Lead
// docs directly and skip this.
const create = async (req, res) => {
  const b = req.body || {};
  b.removed = false;

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
    const a = await Admin.findById(b.assignedUser).select('name surname').lean();
    if (a) b.assignedUserName = `${a.name} ${a.surname || ''}`.trim();
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
    message: 'Successfully Created the document in Model ',
  });
};

module.exports = create;
