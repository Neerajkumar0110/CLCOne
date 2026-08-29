const mongoose = require('mongoose');
const graph = require('@/utils/googleAdsClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/adgroups?campaignId=<id>
const listAdGroups = async (req, res) => {
  const GoogleAdGroup = mongoose.model('GoogleAdGroup');
  const filter = { removed: false };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  const result = await GoogleAdGroup.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/google/adgroups — created PAUSED, always.
const createAdGroup = async (req, res) => {
  const conn = await requireConnection(res, { needCustomer: true });
  if (!conn) return;

  const { name, campaignId, cpcBidMicros } = req.body;
  if (!name || !campaignId) {
    return res.status(400).json({ success: false, result: null, message: 'name and campaignId are required.' });
  }

  const GoogleCampaign = mongoose.model('GoogleCampaign');
  const campaign = await GoogleCampaign.findOne({ _id: campaignId, removed: false }).exec();
  if (!campaign || !campaign.googleCampaignResourceName) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign was not found or not yet created on Google Ads.' });
  }

  const GoogleAdGroup = mongoose.model('GoogleAdGroup');
  const doc = new GoogleAdGroup({
    campaignId,
    customerId: conn.customerId,
    name,
    cpcBidMicros,
  });

  try {
    const accessToken = await getFreshAccessToken(conn);
    const created = await graph.createAdGroup({
      customerId: conn.customerId,
      accessToken,
      loginCustomerId: conn.loginCustomerId,
      name,
      campaignResourceName: campaign.googleCampaignResourceName,
      cpcBidMicros,
    });
    doc.googleAdGroupResourceName = created.resourceName;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Ad Group created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/google/adgroups/:id — local-only field updates (budget/bid
// changes against an already-created Google ad group aren't exposed here yet).
const updateAdGroup = async (req, res) => {
  const GoogleAdGroup = mongoose.model('GoogleAdGroup');
  const doc = await GoogleAdGroup.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Ad Group not found' });

  if (!doc.googleAdGroupResourceName && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Ad Group updated' });
};

module.exports = { listAdGroups, createAdGroup, updateAdGroup };
