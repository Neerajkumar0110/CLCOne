const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');
const { campaignScope, callingTier } = require('./permissions');

const CAMPAIGN_FIELDS = [
  'name',
  'description',
  'campaignType',
  'team',
  'agents',
  'startDate',
  'endDate',
  'callingHoursStart',
  'callingHoursEnd',
  'priority',
  'callerId',
  'dialRatio',
];

// GET /api/calling/campaigns
const list = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const scope = await campaignScope(req);
  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 20, 100);
  const filter = { removed: false, ...scope };
  if (req.query.status && req.query.status !== 'All') filter.status = req.query.status;
  if (req.query.q) filter.name = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const [result, count] = await Promise.all([
    CallCampaign.find(filter)
      .sort({ created: -1 })
      .skip((page - 1) * items)
      .limit(items)
      .populate('agents', 'name surname')
      .lean(),
    CallCampaign.countDocuments(filter),
  ]);
  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
};

// GET /api/calling/campaigns/:id
const read = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const doc = await CallCampaign.findOne({ _id: req.params.id, removed: false })
    .populate('agents', 'name surname email role')
    .lean();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  return res.status(200).json({ success: true, result: doc, message: 'ok' });
};

// POST /api/calling/campaigns
const create = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign name is required.' });
  }
  const doc = {};
  CAMPAIGN_FIELDS.forEach((k) => {
    if (b[k] !== undefined) doc[k] = b[k];
  });
  doc.status = 'Draft';
  doc.createdBy = req.admin._id;
  doc.createdByName = `${req.admin.name} ${req.admin.surname || ''}`.trim();
  const saved = await new CallCampaign(doc).save();
  return res.status(200).json({ success: true, result: saved, message: 'Campaign created' });
};

// PATCH /api/calling/campaigns/:id
const update = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const camp = await CallCampaign.findOne({ _id: req.params.id, removed: false });
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  const b = req.body || {};
  CAMPAIGN_FIELDS.forEach((k) => {
    if (b[k] !== undefined) camp[k] = b[k];
  });
  camp.updated = new Date();
  await camp.save();
  return res.status(200).json({ success: true, result: camp, message: 'Campaign updated' });
};

// POST /api/calling/campaigns/:id/action  { action: start|pause|complete|cancel|schedule }
const VALID = {
  start: 'Active',
  pause: 'Paused',
  complete: 'Completed',
  cancel: 'Cancelled',
  schedule: 'Scheduled',
};
const action = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const AgentCallState = mongoose.model('AgentCallState');
  const camp = await CallCampaign.findOne({ _id: req.params.id, removed: false });
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  const act = String(req.body.action || '').toLowerCase();
  const nextStatus = VALID[act];
  if (!nextStatus) return res.status(400).json({ success: false, result: null, message: 'Unknown action.' });

  const provider = getProvider();
  let pr = { ok: true };
  if (act === 'start') pr = await provider.startCampaign(camp);
  else if (act === 'pause') pr = await provider.pauseCampaign(camp);
  else if (act === 'complete' || act === 'cancel') pr = await provider.stopCampaign(camp);
  if (!pr.ok) return res.status(400).json({ success: false, result: null, message: pr.error });

  camp.status = nextStatus;
  if (act === 'start') {
    camp.activatedAt = new Date();
    // Bring assigned agents online (Available) so the auto-dialer can feed them.
    if (camp.agents && camp.agents.length) {
      await Promise.all(
        camp.agents.map((a) =>
          AgentCallState.updateOne(
            { agent: a },
            { $setOnInsert: { agent: a }, $set: { status: 'Available', campaign: camp._id, since: new Date(), lastSeenAt: new Date() } },
            { upsert: true }
          )
        )
      );
    }
  }
  if (act === 'complete' || act === 'cancel') {
    camp.completedAt = new Date();
    await AgentCallState.updateMany({ campaign: camp._id }, { $set: { status: 'Offline', campaign: null, currentCall: null } });
  }
  await camp.save();
  return res.status(200).json({ success: true, result: camp, message: `Campaign ${act}` });
};

// DELETE /api/calling/campaigns/:id  (soft)
const remove = async (req, res) => {
  if (callingTier(req) !== 'admin') {
    return res.status(403).json({ success: false, result: null, message: 'Admins only.' });
  }
  const CallCampaign = mongoose.model('CallCampaign');
  const doc = await CallCampaign.findOneAndUpdate(
    { _id: req.params.id, removed: false },
    { $set: { removed: true } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  return res.status(200).json({ success: true, result: doc, message: 'Campaign removed' });
};

module.exports = { list, read, create, update, action, remove };
