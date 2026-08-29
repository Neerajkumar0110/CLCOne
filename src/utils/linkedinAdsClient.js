const fs = require('fs');

// Thin wrapper over the LinkedIn Marketing API. Uses Node's native fetch
// (Node >= 20, already required elsewhere in this app — see
// utils/metaGraphClient.js). Every function throws LinkedInApiError with
// LinkedIn's real error body on failure; nothing in this file ever fakes a
// success response.
//
// NOTE: field/endpoint names below reflect the LinkedIn Marketing API (REST,
// versioned) shape at the time this was written. LinkedIn revises fields and
// resource paths periodically, and some paths below (marked with a comment)
// could not be pinned down with full certainty during research — verify
// against https://learn.microsoft.com/en-us/linkedin/marketing/ before
// relying on this in production, and bump LINKEDIN_API_VERSION as needed.

class LinkedInApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'LinkedInApiError';
    this.details = details;
  }
}

const OAUTH_BASE = 'https://www.linkedin.com/oauth/v2';
const REST_BASE = 'https://api.linkedin.com/rest';
// LinkedIn's OpenID Connect endpoints (userinfo) live under /v2, not /rest,
// and — unlike every /rest/* call below — do NOT take a LinkedIn-Version
// header. Kept as its own constant so that distinction is never accidentally
// lost in a future edit.
const OIDC_BASE = 'https://api.linkedin.com/v2';

function apiVersion() {
  const version = process.env.LINKEDIN_API_VERSION;
  if (!version) throw new Error('LINKEDIN_API_VERSION is not set.');
  return version;
}

// Every /rest/* call needs Authorization + LinkedIn-Version + the Restli
// protocol header. Centralized here so no call site can forget one.
async function restRequest(path, { method = 'GET', params = {}, body, accessToken } = {}) {
  const url = new URL(`${REST_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'LinkedIn-Version': apiVersion(),
    'X-Restli-Protocol-Version': '2.0.0',
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (networkErr) {
    throw new LinkedInApiError(`Could not reach LinkedIn API: ${networkErr.message}`, { networkErr: true });
  }

  // 204/empty-body responses (e.g. successful PATCH) never call res.json().
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new LinkedInApiError(
      json.message || `LinkedIn API request failed with status ${res.status}`,
      { status: res.status, code: json.serviceErrorCode || json.code, raw: json }
    );
  }

  return json;
}

// ---- OAuth ----

function buildOAuthDialogUrl({ redirectUri, state, scope }) {
  const url = new URL(`${OAUTH_BASE}/authorization`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.LINKEDIN_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scope);
  return url.toString();
}

// LinkedIn's token endpoint takes application/x-www-form-urlencoded, not
// JSON — unlike the /rest/* endpoints below. LinkedIn access tokens are
// long-lived (~60 days) and the standard flow does not issue a refresh token
// the way Google's does, so there is no exchangeForLongLivedToken /
// refreshToken step to mirror from metaGraphClient.js — when this token
// expires the admin has to reconnect via OAuth again (see LinkedInConnection
// status 'expired' and the lack of any silent-refresh code path anywhere in
// this integration).
async function exchangeCodeForToken({ code, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });

  let res;
  try {
    res = await fetch(`${OAUTH_BASE}/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (networkErr) {
    throw new LinkedInApiError(`Could not reach LinkedIn OAuth: ${networkErr.message}`, { networkErr: true });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new LinkedInApiError(json.error_description || json.error || `LinkedIn token exchange failed with status ${res.status}`, {
      status: res.status,
      raw: json,
    });
  }
  return json; // { access_token, expires_in, refresh_token?, refresh_token_expires_in?, scope }
}

// Best-effort revoke on disconnect — mirrors the best-effort webhook
// unsubscribe in facebookController/connection.js's disconnectConnection.
async function revokeToken(accessToken) {
  const body = new URLSearchParams({
    token: accessToken,
    client_id: process.env.LINKEDIN_CLIENT_ID,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET,
  });
  const res = await fetch(`${OAUTH_BASE}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new LinkedInApiError(json.error_description || `LinkedIn token revoke failed with status ${res.status}`, { status: res.status, raw: json });
  }
  return json;
}

// ---- Identity ----

// OpenID Connect userinfo — requires the 'openid'/'profile'/'email' scopes
// (added alongside the ads scopes in linkedinController/connect.js) purely
// so this integration can identify which LinkedIn member connected, the same
// role metaGraphClient.getMe() plays for Facebook. The ads scopes alone
// (r_ads, r_ads_leadgen_automation, rw_ads) do not grant access to this
// endpoint.
async function getUserInfo(accessToken) {
  const res = await fetch(`${OIDC_BASE}/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new LinkedInApiError(json.message || `LinkedIn userinfo request failed with status ${res.status}`, { status: res.status, raw: json });
  }
  return json; // { sub, name, email, ... }
}

// ---- Ad Accounts / Organizations ----

async function getAdAccounts(accessToken) {
  const res = await restRequest('/adAccounts', { params: { q: 'search' }, accessToken });
  return res.elements || [];
}

// Organizations (LinkedIn Company Pages) the connected member administers —
// this integration's parallel to Facebook Pages: Lead Gen Forms are owned by
// an Organization, the same way Meta lead forms are owned by a Page.
async function getOrganizationAcls(accessToken) {
  const res = await restRequest('/organizationAcls', {
    params: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' },
    accessToken,
  });
  return res.elements || [];
}

// ---- Campaign Group / Campaign / Creative ----
// LinkedIn's hierarchy is 3-tier (Campaign Group -> Campaign -> Creative),
// unlike Meta's 3-tier-plus-Ad (Campaign -> Ad Set -> Creative -> Ad) — a
// LinkedIn Creative IS the final servable unit, there's no separate "Ad"
// resource to create afterward.

async function createCampaignGroup({ adAccountId, accessToken, name, totalBudget, runSchedule }) {
  const body = {
    account: `urn:li:sponsoredAccount:${adAccountId}`,
    name,
    // Created PAUSED, always — never spend money automatically. Only an
    // explicit "publish" action (updateObjectStatus -> ACTIVE) activates.
    // NOTE: LinkedIn's allowed initial-creation statuses for campaign groups
    // are commonly documented as DRAFT or PAUSED — PAUSED is used here to
    // mirror Facebook's convention exactly, but this should be re-verified
    // against LinkedIn's current Campaign Manager API docs before this ever
    // goes live with a real ad account.
    status: 'PAUSED',
    totalBudget: totalBudget ? { amount: String(totalBudget), currencyCode: 'USD' } : undefined,
    runSchedule: runSchedule || undefined,
  };
  return restRequest(`/adAccounts/${adAccountId}/adCampaignGroups`, { method: 'POST', body, accessToken });
}

async function createCampaign({
  adAccountId,
  accessToken,
  name,
  campaignGroupUrn,
  objectiveType,
  costType,
  dailyBudget,
  totalBudget,
  unitCost,
  targetingCriteria,
}) {
  const body = {
    account: `urn:li:sponsoredAccount:${adAccountId}`,
    campaignGroup: campaignGroupUrn,
    name,
    type: 'SPONSORED_UPDATES',
    objectiveType: objectiveType || 'LEAD_GENERATION',
    costType: costType || 'CPM',
    // See the PAUSED comment on createCampaignGroup above — same caveat here.
    status: 'PAUSED',
    dailyBudget: dailyBudget ? { amount: String(dailyBudget), currencyCode: 'USD' } : undefined,
    totalBudget: totalBudget ? { amount: String(totalBudget), currencyCode: 'USD' } : undefined,
    unitCost: unitCost ? { amount: String(unitCost), currencyCode: 'USD' } : undefined,
    targetingCriteria: targetingCriteria || undefined,
    locale: { country: 'US', language: 'en' },
  };
  return restRequest(`/adAccounts/${adAccountId}/adCampaigns`, { method: 'POST', body, accessToken });
}

async function createCreative({
  adAccountId,
  accessToken,
  campaignUrn,
  commentary,
  headline,
  landingPageUrl,
  callToAction,
  imageUrn,
  leadGenFormUrn,
}) {
  const content = {
    reference: imageUrn || undefined,
  };
  const body = {
    campaign: campaignUrn,
    // See the PAUSED comment on createCampaignGroup above — same caveat here.
    status: 'PAUSED',
    leadgenCallToAction: leadGenFormUrn
      ? {
          destination: leadGenFormUrn,
          label: callToAction || 'Submit',
        }
      : undefined,
    commentary,
    // NOTE: the exact "content" shape for a Sponsored Content lead-gen
    // creative (inline vs. referencing an existing post/share) has moved
    // around LinkedIn's API versions — this is the currently-documented
    // "text ad" style inline shape; verify against LinkedIn's current
    // Creatives API docs before relying on it against a real ad account.
    content: {
      textAd: {
        headline,
        description: commentary,
        landingPage: landingPageUrl,
      },
      ...content,
    },
  };
  return restRequest(`/adAccounts/${adAccountId}/creatives`, { method: 'POST', body, accessToken });
}

// LinkedIn image upload is a two-step process (unlike Meta's single
// multipart POST in metaGraphClient.uploadImage): first register the upload
// to get a pre-signed uploadUrl + the asset's own URN, then PUT the raw
// bytes to that URL directly (not through /rest/*, no LinkedIn-Version
// header on the PUT itself). Only the returned URN is ever kept by callers.
async function uploadImage({ accessToken, organizationId, filePath }) {
  const init = await restRequest('/images?action=initializeUpload', {
    method: 'POST',
    body: { initializeUploadRequest: { owner: `urn:li:organization:${organizationId}` } },
    accessToken,
  });

  const uploadUrl = init.value && init.value.uploadUrl;
  const imageUrn = init.value && init.value.image;
  if (!uploadUrl || !imageUrn) {
    throw new LinkedInApiError('LinkedIn did not return an image upload URL.', { init });
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: fs.readFileSync(filePath),
  });
  if (!putRes.ok) {
    throw new LinkedInApiError(`LinkedIn image binary upload failed with status ${putRes.status}`, { status: putRes.status });
  }

  return imageUrn;
}

// Restli partial-update PATCH — LinkedIn's REST API expresses "set these
// fields" as { patch: { $set: { field: value } } } over HTTP PATCH, unlike
// Meta's plain POST-with-body-fields (metaGraphClient.updateObjectStatus).
// The ONLY caller that should ever pass status: 'ACTIVE' is a controller's
// explicit "publish" action.
async function updateObjectStatus({ path, accessToken, status }) {
  return restRequest(path, {
    method: 'PATCH',
    body: { patch: { $set: { status } } },
    accessToken,
  });
}

// ---- Lead Gen Forms / Lead Sync (polling — LinkedIn has no lead webhook) ----

// Lists the Lead Gen Forms owned by the connected Organization.
// NOTE: the resource name for Lead Gen Forms has moved between
// `leadGenForms` and `leadForms` across LinkedIn API versions during
// research — this uses `leadForms` (the current name as of this writing).
// Verify against https://learn.microsoft.com/en-us/linkedin/marketing/integrations/lead-gen/lead-gen-forms
// before relying on this against a real Organization.
async function getLeadForms({ accessToken, organizationId }) {
  const res = await restRequest('/leadForms', {
    params: { q: 'owner', owner: `(sponsoredAccount:urn:li:organization:${organizationId})` },
    accessToken,
  });
  return res.elements || [];
}

// Fetches lead form responses submitted since `since` (a Date) for one form.
// NOTE: LinkedIn's Lead Sync API resource for form *responses* has also
// moved across API versions — this uses `leadFormResponses` filtered by
// form and a submitted-time lower bound (the currently-documented shape).
// If LinkedIn's docs show a different path/params when this is wired up
// against a real Organization, update this one function — every caller in
// linkedinController/leadSync.js goes through it.
async function getLeadFormResponses({ accessToken, formUrn, since }) {
  const res = await restRequest('/leadFormResponses', {
    params: {
      q: 'form',
      form: formUrn,
      submittedAtAfter: since ? since.getTime() : undefined,
    },
    accessToken,
  });
  return res.elements || [];
}

module.exports = {
  LinkedInApiError,
  buildOAuthDialogUrl,
  exchangeCodeForToken,
  revokeToken,
  getUserInfo,
  getAdAccounts,
  getOrganizationAcls,
  createCampaignGroup,
  createCampaign,
  uploadImage,
  createCreative,
  updateObjectStatus,
  getLeadForms,
  getLeadFormResponses,
};
