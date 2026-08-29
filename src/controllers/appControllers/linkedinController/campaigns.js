const mongoose = require('mongoose');
const client = require('../../../utils/linkedinAdsClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

// GET /api/linkedin/campaigns?campaignGroupId=<id>
const listCampaigns = async (req, res) => {
  const LinkedInCampaign = mongoose.model('LinkedInCampaign');
  const filter = { removed: false };
  if (req.query.campaignGroupId) filter.campaignGroupId = req.query.campaignGroupId;
  const result = await LinkedInCampaign.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/linkedin/campaigns — created PAUSED, always. Mirrors
// facebookController/adsets.js's createAdSet — this is LinkedIn's middle
// tier, carrying targeting/budget, linked to a LinkedInCampaignGroup.
const createCampaign = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const {
    name,
    campaignGroupId,
    dailyBudget,
    totalBudget,
    unitCost,
    objectiveType,
    costType,
    locations,
    industries,
    seniorities,
  } = req.body;

  if (!name || !campaignGroupId) {
    return res.status(400).json({ success: false, result: null, message: 'name and campaignGroupId are required.' });
  }
  if (!dailyBudget && !totalBudget) {
    return res.status(400).json({ success: false, result: null, message: 'dailyBudget or totalBudget is required.' });
  }

  const LinkedInCampaignGroup = mongoose.model('LinkedInCampaignGroup');
  const campaignGroup = await LinkedInCampaignGroup.findOne({ _id: campaignGroupId, removed: false }).exec();
  if (!campaignGroup || !campaignGroup.linkedinCampaignGroupId) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign Group was not found or not yet created on LinkedIn.' });
  }

  const targeting = {
    locations: locations && locations.length ? locations : [],
    industries: industries && industries.length ? industries : [],
    seniorities: seniorities && seniorities.length ? seniorities : [],
  };

  const LinkedInCampaign = mongoose.model('LinkedInCampaign');
  const doc = new LinkedInCampaign({
    campaignGroupId,
    adAccountId: conn.adAccountId,
    name,
    objectiveType: objectiveType || 'LEAD_GENERATION',
    costType: costType || 'CPM',
    dailyBudget,
    totalBudget,
    unitCost,
    targeting,
  });

  try {
    const created = await client.createCampaign({
      adAccountId: conn.adAccountId,
      accessToken: decryptedAccessToken(conn),
      name,
      campaignGroupUrn: `urn:li:sponsoredCampaignGroup:${campaignGroup.linkedinCampaignGroupId}`,
      objectiveType: doc.objectiveType,
      costType: doc.costType,
      dailyBudget,
      totalBudget,
      unitCost,
      targetingCriteria: {
        include: {
          and: [
            targeting.locations.length ? { or: { 'urn:li:adTargetingFacet:locations': targeting.locations } } : undefined,
            targeting.industries.length ? { or: { 'urn:li:adTargetingFacet:industries': targeting.industries } } : undefined,
            targeting.seniorities.length ? { or: { 'urn:li:adTargetingFacet:seniorities': targeting.seniorities } } : undefined,
          ].filter(Boolean),
        },
      },
    });
    doc.linkedinCampaignId = created.id;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/linkedin/campaigns/:id — local-only field updates.
const updateCampaign = async (req, res) => {
  const LinkedInCampaign = mongoose.model('LinkedInCampaign');
  const doc = await LinkedInCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  if (!doc.linkedinCampaignId && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Campaign updated' });
};

// POST /api/linkedin/campaigns/:id/publish — the ONLY path that flips a
// campaign ACTIVE.
const publishCampaign = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const LinkedInCampaign = mongoose.model('LinkedInCampaign');
  const doc = await LinkedInCampaign.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  if (!doc.linkedinCampaignId) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign was not created on LinkedIn yet.' });
  }

  try {
    await client.updateObjectStatus({
      path: `/adAccounts/${doc.adAccountId}/adCampaigns/${doc.linkedinCampaignId}`,
      accessToken: decryptedAccessToken(conn),
      status: 'ACTIVE',
    });
    doc.status = 'ACTIVE';
    doc.lastError = undefined;
    doc.updated = Date.now();
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Campaign published' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { listCampaigns, createCampaign, updateCampaign, publishCampaign };
