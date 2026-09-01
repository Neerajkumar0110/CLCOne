const mongoose = require('mongoose');
const { getProvider } = require('../../../services/calling');
const { callingTier } = require('./permissions');

// GET /api/calling/callbacks?scope=today|upcoming|completed|all&agent=&campaign=
const list = async (req, res) => {
  await getProvider().tick();
  const CallCallback = mongoose.model('CallCallback');

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const filter = { removed: false };
  if (callingTier(req) === 'agent') filter.assignedAgent = req.admin._id;
  if (req.query.agent) filter.assignedAgent = req.query.agent;
  if (req.query.campaign) filter.campaign = req.query.campaign;

  const all = await CallCallback.find(filter)
    .sort({ scheduledAt: 1 })
    .limit(500)
    .populate('campaign', 'name')
    .lean();

  const today = [];
  const upcoming = [];
  const overdue = [];
  const completed = [];
  for (const cb of all) {
    if (cb.status === 'Done' || cb.status === 'Missed' || cb.status === 'Cancelled') {
      completed.push(cb);
      continue;
    }
    const t = new Date(cb.scheduledAt);
    if (t < todayStart) overdue.push(cb);
    else if (t <= todayEnd) today.push(cb);
    else upcoming.push(cb);
  }

  return res.status(200).json({
    success: true,
    result: {
      overdue,
      today,
      upcoming,
      completed: completed.slice(0, 100),
      counts: {
        overdue: overdue.length,
        today: today.length,
        upcoming: upcoming.length,
        completed: completed.length,
      },
    },
    message: 'ok',
  });
};

// POST /api/calling/callbacks  { campaign, phone, contactName, scheduledAt, notes, assignedAgent, callLead }
const create = async (req, res) => {
  const CallCallback = mongoose.model('CallCallback');
  const b = req.body || {};
  if (!b.scheduledAt)
    return res.status(400).json({ success: false, result: null, message: 'Callback date & time are required.' });

  let assignedAgent = b.assignedAgent || req.admin._id;
  let assignedAgentName;
  const a = await mongoose.model('Admin').findById(assignedAgent).select('name surname').lean();
  if (a) assignedAgentName = `${a.name} ${a.surname || ''}`.trim();

  const cb = await new CallCallback({
    campaign: b.campaign || undefined,
    callLead: b.callLead || undefined,
    contactName: b.contactName,
    phone: b.phone,
    scheduledAt: new Date(b.scheduledAt),
    notes: b.notes,
    assignedAgent,
    assignedAgentName,
    createdBy: req.admin._id,
    createdByName: `${req.admin.name} ${req.admin.surname || ''}`.trim(),
  }).save();
  return res.status(200).json({ success: true, result: cb, message: 'Callback scheduled' });
};

// PATCH /api/calling/callbacks/:id  { status }
const update = async (req, res) => {
  const CallCallback = mongoose.model('CallCallback');
  const cb = await CallCallback.findOne({ _id: req.params.id, removed: false });
  if (!cb) return res.status(404).json({ success: false, result: null, message: 'Callback not found' });
  if (callingTier(req) === 'agent' && String(cb.assignedAgent) !== String(req.admin._id)) {
    return res.status(403).json({ success: false, result: null, message: 'Not your callback.' });
  }
  const next = ['Pending', 'Done', 'Missed', 'Cancelled'].includes(req.body.status) ? req.body.status : cb.status;
  cb.status = next;
  if (next === 'Done') cb.completedAt = new Date();
  if (req.body.notes != null) cb.notes = req.body.notes;
  if (req.body.scheduledAt) cb.scheduledAt = new Date(req.body.scheduledAt);
  await cb.save();
  return res.status(200).json({ success: true, result: cb, message: 'Callback updated' });
};

module.exports = { list, create, update };
