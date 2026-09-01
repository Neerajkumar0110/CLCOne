const mongoose = require('mongoose');
const { resolveStageSub, stageConfig } = require('../../../config/leadStages');
const { validateStageRules } = require('./stageValidation');

// PATCH /api/lead/update/:id — updates the SAME lead record (never creates
// a new one). On a stage / sub-status change it appends a stageHistory
// entry (from → to, who, when, remarks) and bumps stageUpdatedAt.
const DATE_FIELDS = [
  'callBackAt',
  'meetingAt',
  'futureFollowUpAt',
  'enrolledAt',
  'registrationLinkSharedAt',
  'lastContactAt',
  'nextFollowUpAt',
];

const EDITABLE = [
  'name',
  'phone',
  'email',
  'source',
  'team',
  'position',
  'image',
  'color',
  'alternatePhone',
  'city',
  'state',
  'country',
  'zipcode',
  'remarks',
  'registrationLink',
  ...DATE_FIELDS,
];

const update = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const lead = await Lead.findOne({ _id: req.params.id, removed: false });
  if (!lead) {
    return res.status(404).json({ success: false, result: null, message: 'Lead not found' });
  }

  const b = req.body || {};
  const wantsPipelineChange =
    b.stage !== undefined || b.subStatus !== undefined || b.status !== undefined;

  let nextStage = lead.stage;
  let nextSub = lead.subStatus;
  if (wantsPipelineChange) {
    const r = resolveStageSub({
      stage: b.stage,
      subStatus: b.subStatus,
      status: b.stage === undefined ? b.status : undefined,
    });
    nextStage = r.stage;
    nextSub = r.subStatus;
    const merged = { ...lead.toObject(), ...b };
    const ruleErr = validateStageRules(nextStage, nextSub, merged);
    if (ruleErr) {
      return res.status(400).json({ success: false, result: null, message: ruleErr });
    }
  }

  const prevStage = lead.stage;
  const prevSub = lead.subStatus;
  const pipelineChanged = nextStage !== prevStage || nextSub !== prevSub;

  EDITABLE.forEach((k) => {
    if (b[k] === undefined) return;
    lead[k] = b[k] === '' && DATE_FIELDS.includes(k) ? null : b[k];
  });

  if (wantsPipelineChange) {
    lead.stage = nextStage;
    lead.subStatus = nextSub;
  }

  // Assigned user (+ denormalised name).
  if (b.assignedUser === '' || b.assignedUser === null) {
    lead.assignedUser = undefined;
    lead.assignedUserName = undefined;
  } else if (b.assignedUser !== undefined) {
    const Admin = mongoose.model('Admin');
    const a = await Admin.findById(b.assignedUser).select('name surname').lean();
    lead.assignedUser = b.assignedUser;
    lead.assignedUserName = a ? `${a.name} ${a.surname || ''}`.trim() : undefined;
  }

  if (pipelineChanged) {
    lead.stageUpdatedAt = new Date();
    lead.stageHistory.push({
      fromStage: prevStage,
      fromSubStatus: prevSub,
      toStage: nextStage,
      toSubStatus: nextSub,
      changedBy: req.admin ? req.admin._id : undefined,
      changedByName: req.admin
        ? `${req.admin.name} ${req.admin.surname || ''}`.trim()
        : undefined,
      remarks: b.stageRemarks || undefined,
      at: new Date(),
    });

    // Auto-stamps.
    const cfg = stageConfig(nextStage);
    if (nextStage === 'Enrolled' && !lead.enrolledAt) lead.enrolledAt = new Date();
    if (
      cfg &&
      cfg.linkSubStatuses &&
      cfg.linkSubStatuses.includes(nextSub) &&
      lead.registrationLink &&
      !lead.registrationLinkSharedAt
    ) {
      lead.registrationLinkSharedAt = new Date();
    }
  }

  lead.updated = new Date();
  await lead.save();

  return res.status(200).json({ success: true, result: lead, message: 'Lead updated' });
};

module.exports = update;
