const mongoose = require('mongoose');
const { callingTier } = require('./permissions');

// CRUD for IVR menus. Managers+ can edit; everyone in the calling module can
// read (agents need the labels to make sense of call history).

const FIELDS = [
  'name',
  'description',
  'direction',
  'greeting',
  'promptKey',
  'options',
  'noInputAction',
  'invalidAction',
  'fallbackTeam',
  'fallbackNumber',
  'providerFlowId',
  'enabled',
];

const sanitizeOptions = (raw) => {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter((o) => o && String(o.digit || '').trim() && String(o.label || '').trim())
    .map((o) => ({
      digit: String(o.digit).trim(),
      label: String(o.label).trim(),
      action: o.action || 'route_team',
      targetTeam: o.targetTeam || undefined,
      targetAgent: mongoose.isValidObjectId(o.targetAgent) ? o.targetAgent : undefined,
      targetNumber: o.targetNumber ? String(o.targetNumber).trim() : undefined,
    }));
};

const list = async (req, res) => {
  const IvrFlow = mongoose.model('IvrFlow');
  const filter = { removed: false };
  if (req.query.direction) filter.direction = req.query.direction;
  const items = await IvrFlow.find(filter).sort({ created: -1 }).populate('options.targetAgent', 'name surname').lean();
  return res.status(200).json({ success: true, result: items, message: 'ok' });
};

const read = async (req, res) => {
  const IvrFlow = mongoose.model('IvrFlow');
  const doc = await IvrFlow.findOne({ _id: req.params.id, removed: false })
    .populate('options.targetAgent', 'name surname')
    .lean();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'IVR flow not found' });
  return res.status(200).json({ success: true, result: doc, message: 'ok' });
};

const create = async (req, res) => {
  const IvrFlow = mongoose.model('IvrFlow');
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ success: false, result: null, message: 'IVR flow name is required.' });
  }
  const doc = {};
  FIELDS.forEach((k) => {
    if (b[k] !== undefined) doc[k] = b[k];
  });
  const opts = sanitizeOptions(b.options);
  if (opts) doc.options = opts;
  doc.createdBy = req.admin._id;
  doc.createdByName = `${req.admin.name} ${req.admin.surname || ''}`.trim();
  const saved = await new IvrFlow(doc).save();
  return res.status(200).json({ success: true, result: saved, message: 'IVR flow created' });
};

const update = async (req, res) => {
  const IvrFlow = mongoose.model('IvrFlow');
  const doc = await IvrFlow.findOne({ _id: req.params.id, removed: false });
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'IVR flow not found' });
  const b = req.body || {};
  FIELDS.forEach((k) => {
    if (b[k] !== undefined && k !== 'options') doc[k] = b[k];
  });
  const opts = sanitizeOptions(b.options);
  if (opts) doc.options = opts;
  doc.updated = new Date();
  await doc.save();
  return res.status(200).json({ success: true, result: doc, message: 'IVR flow updated' });
};

const remove = async (req, res) => {
  if (callingTier(req) !== 'admin') {
    return res.status(403).json({ success: false, result: null, message: 'Admins only.' });
  }
  const IvrFlow = mongoose.model('IvrFlow');
  const doc = await IvrFlow.findOneAndUpdate(
    { _id: req.params.id, removed: false },
    { $set: { removed: true } },
    { new: true }
  );
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'IVR flow not found' });
  return res.status(200).json({ success: true, result: doc, message: 'IVR flow removed' });
};

module.exports = { list, read, create, update, remove };
