const mongoose = require('mongoose');
const graph = require('@/utils/metaGraphClient');
const { requireConnection, decryptedPageToken } = require('./_helpers');

// Meta lead form "questions" only support a fixed vocabulary of built-in
// types (plus CUSTOM for free-text) — map this app's capture-form field keys
// onto the closest Meta question type.
const QUESTION_TYPE_BY_KEY = {
  name: 'FULL_NAME',
  email: 'EMAIL',
  whatsapp: 'PHONE',
};

function fieldsToQuestions(fields) {
  const enabled = (fields || []).filter((f) => f.enabled);
  const questions = enabled.map((f) => {
    const builtIn = QUESTION_TYPE_BY_KEY[f.key];
    return builtIn ? { type: builtIn } : { type: 'CUSTOM', label: f.label };
  });
  return questions.length ? questions : [{ type: 'FULL_NAME' }, { type: 'PHONE' }];
}

// GET /api/facebook/forms — the Facebook-Ads capture form config, including
// whether a Meta Lead Form has actually been created for it yet.
const getForms = async (req, res) => {
  const CaptureFormConfig = mongoose.model('CaptureFormConfig');
  const config = await CaptureFormConfig.findOne({ removed: false, platform: 'Facebook Ads' }).exec();
  return res.status(200).json({ success: true, result: config || null, message: 'OK' });
};

// POST /api/facebook/forms — creates the Meta Lead Generation Form for the
// currently enabled fields on the Facebook-Ads capture form, and saves the
// returned Meta form id. Requires a connected, page-selected account.
const createForm = async (req, res) => {
  const conn = await requireConnection(res, { needPage: true });
  if (!conn) return;

  const CaptureFormConfig = mongoose.model('CaptureFormConfig');
  let config = await CaptureFormConfig.findOne({ removed: false, platform: 'Facebook Ads' }).exec();
  if (!config) {
    return res.status(400).json({ success: false, result: null, message: 'Save the capture form fields first.' });
  }

  const { privacyPolicyUrl } = req.body;
  if (!privacyPolicyUrl) {
    return res.status(400).json({ success: false, result: null, message: 'privacyPolicyUrl is required by Meta for lead forms.' });
  }

  try {
    const created = await graph.createLeadForm({
      pageId: conn.pageId,
      pageAccessToken: decryptedPageToken(conn),
      name: req.body.name || 'Website Lead Form',
      privacyPolicyUrl,
      questions: fieldsToQuestions(config.fields),
    });

    config.metaFormId = created.id;
    config.pageId = conn.pageId;
    config.status = 'created';
    config.lastError = undefined;
    config.updated = Date.now();
    await config.save();

    return res.status(200).json({ success: true, result: config, message: 'Meta Lead Form created' });
  } catch (err) {
    config.status = 'error';
    config.lastError = err.message;
    await config.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = { getForms, createForm };
