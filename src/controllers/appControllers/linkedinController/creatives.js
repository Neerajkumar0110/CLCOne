const mongoose = require('mongoose');
const path = require('path');
const client = require('../../../utils/linkedinAdsClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

// GET /api/linkedin/creatives?campaignId=<id>
const listCreatives = async (req, res) => {
  const LinkedInCreative = mongoose.model('LinkedInCreative');
  const filter = { removed: false };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  const result = await LinkedInCreative.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/linkedin/creatives (multipart: file=<image>) — uploads the
// image to LinkedIn first (only the returned asset URN is ever stored — the
// raw file stays local disk under src/public/uploads/linkedincreative/, it
// is never written into the leads collection or sent back to the frontend
// as a blob), then creates the Creative referencing the selected Lead Gen
// Form. Mirrors facebookController/creatives.js's createCreative; unlike
// Meta, a LinkedIn Creative is already the final servable unit — there's no
// separate "Ad" object to create afterward (see publishCreative below,
// which plays the role facebookController/ads.js's publishAd plays for
// Meta).
const createCreative = async (req, res) => {
  const conn = await requireConnection(res, { needOrganization: true, needAdAccount: true });
  if (!conn) return;

  const { name, campaignId, commentary, headline, landingPageUrl, callToAction, leadGenFormId } = req.body;

  if (!name || !campaignId || !leadGenFormId) {
    return res.status(400).json({ success: false, result: null, message: 'name, campaignId and leadGenFormId are required.' });
  }
  if (!req.upload) {
    return res.status(400).json({ success: false, result: null, message: 'No image file uploaded.' });
  }

  const LinkedInCampaign = mongoose.model('LinkedInCampaign');
  const campaign = await LinkedInCampaign.findOne({ _id: campaignId, removed: false }).exec();
  if (!campaign || !campaign.linkedinCampaignId) {
    return res.status(400).json({ success: false, result: null, message: 'Campaign was not found or not yet created on LinkedIn.' });
  }

  const LinkedInCreative = mongoose.model('LinkedInCreative');
  const doc = new LinkedInCreative({
    adAccountId: conn.adAccountId,
    organizationId: conn.organizationId,
    campaignId,
    name,
    commentary,
    headline,
    landingPageUrl,
    callToAction: callToAction || 'Submit',
    leadGenFormId,
  });

  const accessToken = decryptedAccessToken(conn);
  const filePath = path.join('src', req.upload.filePath);

  try {
    doc.imageUrn = await client.uploadImage({
      accessToken,
      organizationId: conn.organizationId,
      filePath,
    });

    const created = await client.createCreative({
      adAccountId: conn.adAccountId,
      accessToken,
      campaignUrn: `urn:li:sponsoredCampaign:${campaign.linkedinCampaignId}`,
      commentary,
      headline,
      landingPageUrl,
      callToAction: doc.callToAction,
      imageUrn: doc.imageUrn,
      leadGenFormUrn: `urn:li:leadGenForm:${leadGenFormId}`,
    });

    doc.linkedinCreativeId = created.id;
    await doc.save();

    return res.status(200).json({ success: true, result: doc, message: 'Creative created (PAUSED)' });
  } catch (err) {
    // No 'error' status in the enum (mirrors FacebookCampaign/FacebookAdSet's
    // convention, not FacebookAdCreative's — status here tracks LinkedIn's
    // real PAUSED/ACTIVE/ARCHIVED lifecycle, so a failed create just leaves
    // it at the default and surfaces the failure via lastError instead).
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// PATCH /api/linkedin/creatives/:id — local-only field updates.
const updateCreative = async (req, res) => {
  const LinkedInCreative = mongoose.model('LinkedInCreative');
  const doc = await LinkedInCreative.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Creative not found' });

  if (!doc.linkedinCreativeId && req.body.name) doc.name = req.body.name;
  doc.updated = Date.now();
  await doc.save();

  return res.status(200).json({ success: true, result: doc, message: 'Creative updated' });
};

// POST /api/linkedin/creatives/:id/publish — the ONLY path that flips a
// creative ACTIVE (mirrors facebookController/ads.js's publishAd, since a
// LinkedIn Creative plays that combined creative+ad role).
const publishCreative = async (req, res) => {
  const conn = await requireConnection(res, { needAdAccount: true });
  if (!conn) return;

  const LinkedInCreative = mongoose.model('LinkedInCreative');
  const doc = await LinkedInCreative.findOne({ _id: req.params.id, removed: false }).exec();
  if (!doc) return res.status(404).json({ success: false, result: null, message: 'Creative not found' });
  if (!doc.linkedinCreativeId) {
    return res.status(400).json({ success: false, result: null, message: 'Creative was not created on LinkedIn yet.' });
  }

  try {
    await client.updateObjectStatus({
      path: `/adAccounts/${doc.adAccountId}/creatives/${doc.linkedinCreativeId}`,
      accessToken: decryptedAccessToken(conn),
      status: 'ACTIVE',
    });
    doc.status = 'ACTIVE';
    doc.lastError = undefined;
    doc.updated = Date.now();
    await doc.save();
    return res.status(200).json({ success: true, result: doc, message: 'Creative published' });
  } catch (err) {
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { listCreatives, createCreative, updateCreative, publishCreative };
