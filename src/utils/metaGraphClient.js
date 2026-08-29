const fs = require('fs');

// Thin wrapper over the Meta Graph API / Marketing API. Uses Node's native
// fetch (Node >= 20, already required elsewhere in this app). The API
// version is entirely env-driven (META_API_VERSION) — never hard-coded here.
// Every function throws MetaApiError with Meta's real error body on failure;
// nothing in this file ever fakes a success response.
//
// NOTE: field/endpoint names below reflect the Marketing API shape at the
// time this was written. Meta revises fields/objectives periodically —
// verify against https://developers.facebook.com/docs/marketing-apis before
// relying on this in production, and bump META_API_VERSION as needed.

class MetaApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'MetaApiError';
    this.details = details;
  }
}

function baseUrl() {
  const version = process.env.META_API_VERSION;
  if (!version) throw new Error('META_API_VERSION is not set.');
  return `https://graph.facebook.com/${version}`;
}

async function graphRequest(path, { method = 'GET', params = {}, body, isForm = false } = {}) {
  const url = new URL(`${baseUrl()}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const init = { method };
  if (body && !isForm) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  } else if (body && isForm) {
    init.body = body; // FormData — fetch sets the multipart boundary header itself
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (networkErr) {
    throw new MetaApiError(`Could not reach Meta Graph API: ${networkErr.message}`, { networkErr: true });
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.error) {
    const metaError = json.error || {};
    throw new MetaApiError(
      metaError.message || `Meta API request failed with status ${res.status}`,
      { status: res.status, code: metaError.code, type: metaError.type, fbtrace_id: metaError.fbtrace_id }
    );
  }

  return json;
}

// ---- OAuth ----

function buildOAuthDialogUrl({ redirectUri, state, scope }) {
  const url = new URL('https://www.facebook.com/' + process.env.META_API_VERSION + '/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scope);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

async function exchangeCodeForToken({ code, redirectUri }) {
  return graphRequest('/oauth/access_token', {
    params: {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    },
  });
}

async function exchangeForLongLivedToken(shortLivedToken) {
  return graphRequest('/oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: shortLivedToken,
    },
  });
}

// ---- Identity / Pages / Ad Accounts ----

async function getMe(accessToken) {
  return graphRequest('/me', { params: { fields: 'id,name', access_token: accessToken } });
}

async function getPages(userAccessToken) {
  const res = await graphRequest('/me/accounts', {
    params: { fields: 'id,name,access_token,category', access_token: userAccessToken },
  });
  return res.data || [];
}

async function getAdAccounts(userAccessToken) {
  const res = await graphRequest('/me/adaccounts', {
    params: { fields: 'id,name,account_id,currency,account_status', access_token: userAccessToken },
  });
  return res.data || [];
}

// ---- Lead Forms ----

async function createLeadForm({ pageId, pageAccessToken, name, privacyPolicyUrl, questions }) {
  return graphRequest(`/${pageId}/leadgen_forms`, {
    method: 'POST',
    body: {
      name,
      privacy_policy: { url: privacyPolicyUrl, link_text: 'Privacy Policy' },
      questions: questions && questions.length ? questions : [{ type: 'FULL_NAME' }, { type: 'PHONE' }],
      access_token: pageAccessToken,
    },
  });
}

async function subscribePageWebhook({ pageId, pageAccessToken }) {
  return graphRequest(`/${pageId}/subscribed_apps`, {
    method: 'POST',
    params: { subscribed_fields: 'leadgen', access_token: pageAccessToken },
  });
}

// ---- Campaign / Ad Set / Creative / Ad ----

async function createCampaign({ adAccountId, userAccessToken, name, objective, specialAdCategories }) {
  return graphRequest(`/${adAccountId}/campaigns`, {
    method: 'POST',
    body: {
      name,
      objective: objective || 'OUTCOME_LEADS',
      status: 'PAUSED',
      special_ad_categories: specialAdCategories && specialAdCategories.length ? specialAdCategories : [],
      access_token: userAccessToken,
    },
  });
}

async function createAdSet({
  adAccountId,
  userAccessToken,
  name,
  campaignId,
  pageId,
  dailyBudget,
  lifetimeBudget,
  startTime,
  endTime,
  targeting,
  billingEvent,
  optimizationGoal,
}) {
  return graphRequest(`/${adAccountId}/adsets`, {
    method: 'POST',
    body: {
      name,
      campaign_id: campaignId,
      daily_budget: dailyBudget || undefined,
      lifetime_budget: !dailyBudget ? lifetimeBudget : undefined,
      start_time: startTime,
      end_time: endTime,
      billing_event: billingEvent || 'IMPRESSIONS',
      optimization_goal: optimizationGoal || 'LEAD_GENERATION',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      promoted_object: { page_id: pageId },
      status: 'PAUSED',
      access_token: userAccessToken,
    },
  });
}

async function uploadImage({ adAccountId, userAccessToken, filePath, fileName }) {
  const form = new FormData();
  form.append('access_token', userAccessToken);
  form.append(fileName, new Blob([fs.readFileSync(filePath)]), fileName);
  const res = await graphRequest(`/${adAccountId}/adimages`, { method: 'POST', body: form, isForm: true });
  const entry = res.images && Object.values(res.images)[0];
  if (!entry || !entry.hash) throw new MetaApiError('Meta did not return an image hash.', { res });
  return entry.hash;
}

async function uploadVideo({ adAccountId, userAccessToken, filePath, fileName }) {
  const form = new FormData();
  form.append('access_token', userAccessToken);
  form.append('source', new Blob([fs.readFileSync(filePath)]), fileName);
  const res = await graphRequest(`/${adAccountId}/advideos`, { method: 'POST', body: form, isForm: true });
  if (!res.id) throw new MetaApiError('Meta did not return a video id.', { res });
  return res.id;
}

async function createAdCreative({
  adAccountId,
  userAccessToken,
  name,
  pageId,
  primaryText,
  headline,
  description,
  callToAction,
  imageHash,
  videoId,
  metaFormId,
}) {
  const linkData = {
    message: primaryText,
    name: headline,
    description,
    call_to_action: { type: callToAction || 'LEARN_MORE', value: { lead_gen_form_id: metaFormId } },
  };
  if (imageHash) linkData.image_hash = imageHash;
  if (videoId) linkData.video_id = videoId;

  return graphRequest(`/${adAccountId}/adcreatives`, {
    method: 'POST',
    body: {
      name,
      object_story_spec: { page_id: pageId, link_data: linkData },
      access_token: userAccessToken,
    },
  });
}

async function createAd({ adAccountId, userAccessToken, name, adSetId, creativeId }) {
  return graphRequest(`/${adAccountId}/ads`, {
    method: 'POST',
    body: {
      name,
      adset_id: adSetId,
      creative: { creative_id: creativeId },
      status: 'PAUSED',
      access_token: userAccessToken,
    },
  });
}

async function updateObjectStatus({ objectId, userAccessToken, status }) {
  return graphRequest(`/${objectId}`, { method: 'POST', body: { status, access_token: userAccessToken } });
}

// ---- Leads ----

async function getLeadData({ leadgenId, pageAccessToken }) {
  return graphRequest(`/${leadgenId}`, {
    params: {
      fields: 'field_data,created_time,ad_id,form_id,campaign_id,adset_id',
      access_token: pageAccessToken,
    },
  });
}

module.exports = {
  MetaApiError,
  buildOAuthDialogUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMe,
  getPages,
  getAdAccounts,
  createLeadForm,
  subscribePageWebhook,
  createCampaign,
  createAdSet,
  uploadImage,
  uploadVideo,
  createAdCreative,
  createAd,
  updateObjectStatus,
  getLeadData,
};
