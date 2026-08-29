const mongoose = require('mongoose');
const graph = require('@/utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/adsets?campaignId=<id>
const listAdSets = async (req, res) => {
  const FacebookAdSet = mongoose.model('FacebookAdSet');
  const filter = { removed: false };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  const result = await FacebookAdSet.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/facebook/adsets — created PAUSED, always.
const createAdSet = async (req, res) => {
  const conn = await requireConnection(res, { needPage: true, needAdAccount: true });
  if (!conn) return;

  const {
    name,
    campaignId,
    dailyBudget,
    lifetimeBudget,
    startTime,
    endTime,
    countries,
    ageMin,
    ageMax,
    genders,
    placements,
    optimizationGoal,
    billingEvent,
  } = req.body;

  if (!name || !campaignId) {
    return res.status(400).json({ success: false, result: null, message: 'name and campaignId are required.' });
  }
  if (!dailyBudget && !lifetimeBudget) {
    return res.status(400).json({ success: false, result: null, message: 'dailyBudget or lifetimeBudget is required.' });
  }

  const FacebookCampaign = mongoose.model('FacebookCampaign');
  const campaign = await FacebookCampaign.findOne({ _id: campaignId, removed: false }).exec();
  if (!campaign || !campaign.metaCampaignId) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign was not found or not yet created on Meta.' });
  }

  const targeting = {
    countries: countries && countries.length ? countries : ['IN'],
    ageMin: ageMin || 18,
    ageMax: ageMax || 65,
    genders: genders && genders.length ? genders : [],
  };

  const FacebookAdSet = mongoose.model('FacebookAdSet');
  const doc = new FacebookAdSet({
    campaignId,
    adAccountId: conn.adAccountId,
    name,
    dailyBudget,
    lifetimeBudget,
    startTime,
    endTime,
    targeting,
    placements,
    optimizationGoal,
    billingEvent,
  });

  try {
    const created = await graph.createAdSet({
      adAccountId: conn.adAccountId,
      userAccessToken: decryptedUserToken(conn),
      name,
      campaignId: campaign.metaCampaignId,
      pageId: conn.pageId,
      dailyBudget,
      lifetimeBudget,
      startTime,
      endTime,
      billingEvent: doc.billingEvent,
      optimizationGoal: doc.optimizationGoal,
      targeting: {
        geo_locations: { countries: targeting.countries },
        age_min: targeting.ageMin,
        age_max: targeting.ageMax,
        genders: targeting.genders.length ? targeting.genders : undefined,
        publisher_platforms: (placements && placements.length ? placements : ['facebook', 'instagram']),
      },
    });
    doc.metaAdSetId = created.id;
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Ad Set created (PAUSED)' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/facebook/adsets/:id — local-only field updates (budget/schedule
// changes against an already-created Meta ad set aren't exposed here yet).
const updateAdSet = async (req, res) => {
  const FacebookAdSet = mongoose.model('FacebookAdSet');
  const doc = await FacebookAdSet.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Ad Set not found' });

  if (!doc.metaAdSetId && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Ad Set updated' });
};

module.exports = { listAdSets, createAdSet, updateAdSet };
