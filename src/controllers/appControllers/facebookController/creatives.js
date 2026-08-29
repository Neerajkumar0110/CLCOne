const mongoose = require('mongoose');
const path = require('path');
const graph = require('../../../utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/creatives?campaignId=<id>
const listCreatives = async (req, res) => {
  const FacebookAdCreative = mongoose.model('FacebookAdCreative');
  const filter = { removed: false };
  if (req.query.campaignId) filter.campaignId = req.query.campaignId;
  const result = await FacebookAdCreative.find(filter).sort({ created: -1 }).exec();
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/facebook/creatives (multipart: file=<image|video>) — uploads the
// media to Meta first (only the returned hash/video id is ever stored — the
// raw file stays local disk under src/public/uploads/adcreative/, it is
// never written into the leads collection or sent back to the frontend as a
// blob), then creates the Ad Creative referencing the selected Lead Form.
const createCreative = async (req, res) => {
  const conn = await requireConnection(res, { needPage: true, needAdAccount: true });
  if (!conn) return;

  const { name, campaignId, adSetId, primaryText, headline, description, callToAction, metaFormId, mediaType } = req.body;

  if (!name || !metaFormId) {
    return res.status(400).json({ success: false, result: null, message: 'name and metaFormId are required.' });
  }
  if (!req.upload) {
    return res.status(400).json({ success: false, result: null, message: 'No media file uploaded.' });
  }

  const FacebookAdCreative = mongoose.model('FacebookAdCreative');
  const doc = new FacebookAdCreative({
    adAccountId: conn.adAccountId,
    pageId: conn.pageId,
    campaignId: campaignId || undefined,
    adSetId: adSetId || undefined,
    name,
    mediaType: mediaType === 'video' ? 'video' : 'image',
    primaryText,
    headline,
    description,
    callToAction,
    metaFormId,
  });

  const userAccessToken = decryptedUserToken(conn);
  const filePath = path.join('src', req.upload.filePath);

  try {
    if (doc.mediaType === 'video') {
      doc.metaVideoId = await graph.uploadVideo({
        adAccountId: conn.adAccountId,
        userAccessToken,
        filePath,
        fileName: req.upload.fileName,
      });
    } else {
      doc.metaImageHash = await graph.uploadImage({
        adAccountId: conn.adAccountId,
        userAccessToken,
        filePath,
        fileName: req.upload.fileName,
      });
    }

    const created = await graph.createAdCreative({
      adAccountId: conn.adAccountId,
      userAccessToken,
      name,
      pageId: conn.pageId,
      primaryText,
      headline,
      description,
      callToAction,
      imageHash: doc.metaImageHash,
      videoId: doc.metaVideoId,
      metaFormId,
    });

    doc.metaCreativeId = created.id;
    doc.status = 'created';
    await doc.save();

    return res.status(200).json({ success: true, result: doc, message: 'Ad Creative created' });
  } catch (err) {
    doc.status = 'error';
    doc.lastError = err.message;
    await doc.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { listCreatives, createCreative };
