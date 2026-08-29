// Thin wrapper over Google's OAuth 2.0 token endpoint and the Google Ads API
// REST interface. Uses Node's native fetch (Node >= 20, already required
// elsewhere in this app). The Ads API version is entirely env-driven
// (GOOGLE_ADS_API_VERSION) — never hard-coded here, since Google deprecates
// old versions on a schedule. Every function throws GoogleAdsApiError with
// Google's real error body on failure; nothing in this file ever fakes a
// success response. Deliberately mirrors utils/metaGraphClient.js's shape:
// one function per API call, uniform error type.
//
// NOTE: field/endpoint names below reflect the Google Ads API REST shape at
// the time this was written — verify against
// https://developers.google.com/google-ads/api/rest/overview before relying
// on this in production, and bump GOOGLE_ADS_API_VERSION as needed.

class GoogleAdsApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.details = details;
  }
}

function adsApiBaseUrl() {
  const version = process.env.GOOGLE_ADS_API_VERSION;
  if (!version) throw new Error('GOOGLE_ADS_API_VERSION is not set.');
  return `https://googleads.googleapis.com/${version}`;
}

function developerToken() {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is not set.');
  return token;
}

// ---- Low-level request helpers ----

// The OAuth token endpoint (oauth2.googleapis.com) is a separate host from
// the Ads API and speaks form-urlencoded, not JSON — kept as its own helper
// rather than forced into googleAdsRequest below.
async function oauthTokenRequest(params) {
  let res;
  try {
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch (networkErr) {
    throw new GoogleAdsApiError(`Could not reach Google's OAuth token endpoint: ${networkErr.message}`, {
      networkErr: true,
    });
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.error) {
    throw new GoogleAdsApiError(json.error_description || json.error || `OAuth token request failed with status ${res.status}`, {
      status: res.status,
      error: json.error,
    });
  }

  return json;
}

async function googleAdsRequest(path, { method = 'GET', body, accessToken, loginCustomerId } = {}) {
  if (!accessToken) throw new GoogleAdsApiError('No Google Ads access token supplied.');

  const url = `${adsApiBaseUrl()}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken(),
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, init);
  } catch (networkErr) {
    throw new GoogleAdsApiError(`Could not reach Google Ads API: ${networkErr.message}`, { networkErr: true });
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errBody = json.error || json;
    throw new GoogleAdsApiError(errBody.message || `Google Ads API request failed with status ${res.status}`, {
      status: res.status,
      code: errBody.code,
      status_: errBody.status,
      details: errBody.details,
    });
  }

  return json;
}

// ---- OAuth ----

function buildOAuthDialogUrl({ redirectUri, state, scope }) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_ADS_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  // access_type=offline + prompt=consent are both required to get a
  // refresh_token back — without prompt=consent, Google only issues one on
  // the account's very first-ever authorization for this app.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCodeForToken({ code, redirectUri }) {
  return oauthTokenRequest({
    code,
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
}

async function refreshAccessToken({ refreshToken }) {
  return oauthTokenRequest({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
}

// ---- Identity / Customer accounts ----

async function getUserInfo(accessToken) {
  let res;
  try {
    res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (networkErr) {
    throw new GoogleAdsApiError(`Could not reach Google's userinfo endpoint: ${networkErr.message}`, {
      networkErr: true,
    });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GoogleAdsApiError(json.error_description || json.error || `userinfo request failed with status ${res.status}`, {
      status: res.status,
    });
  }
  return json; // { sub, email, ... }
}

// Returns bare customer ids (digits only, "customers/" prefix stripped).
async function listAccessibleCustomers(accessToken) {
  const res = await googleAdsRequest('/customers:listAccessibleCustomers', { accessToken });
  return (res.resourceNames || []).map((rn) => rn.replace('customers/', ''));
}

// GAQL search for the one row of customer-level fields — listAccessibleCustomers
// alone doesn't return a human-readable name/currency/status.
async function getCustomerInfo({ customerId, accessToken, loginCustomerId }) {
  const res = await googleAdsRequest(`/customers/${customerId}/googleAds:search`, {
    method: 'POST',
    accessToken,
    loginCustomerId: loginCustomerId || customerId,
    body: {
      query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status FROM customer LIMIT 1',
    },
  });
  const row = (res.results && res.results[0] && res.results[0].customer) || {};
  return {
    customerId,
    descriptiveName: row.descriptiveName,
    currencyCode: row.currencyCode,
    status: row.status,
  };
}

// ---- Campaign / Ad Group / Ad ----

async function createCampaignBudget({ customerId, accessToken, loginCustomerId, name, amountMicros }) {
  const res = await googleAdsRequest(`/customers/${customerId}/campaignBudgets:mutate`, {
    method: 'POST',
    accessToken,
    loginCustomerId,
    body: {
      operations: [
        {
          create: {
            name,
            amountMicros: String(amountMicros),
            deliveryMethod: 'STANDARD',
          },
        },
      ],
    },
  });
  const result = res.results && res.results[0];
  if (!result || !result.resourceName) throw new GoogleAdsApiError('Google Ads did not return a campaign budget resource name.', { res });
  return result;
}

async function createCampaign({ customerId, accessToken, loginCustomerId, name, advertisingChannelType, campaignBudgetResourceName }) {
  const res = await googleAdsRequest(`/customers/${customerId}/campaigns:mutate`, {
    method: 'POST',
    accessToken,
    loginCustomerId,
    body: {
      operations: [
        {
          create: {
            name,
            advertisingChannelType: advertisingChannelType || 'SEARCH',
            status: 'PAUSED',
            campaignBudget: campaignBudgetResourceName,
          },
        },
      ],
    },
  });
  const result = res.results && res.results[0];
  if (!result || !result.resourceName) throw new GoogleAdsApiError('Google Ads did not return a campaign resource name.', { res });
  return result;
}

async function createAdGroup({ customerId, accessToken, loginCustomerId, name, campaignResourceName, cpcBidMicros }) {
  const create = {
    name,
    campaign: campaignResourceName,
    status: 'PAUSED',
    type: 'SEARCH_STANDARD',
  };
  if (cpcBidMicros) create.cpcBidMicros = String(cpcBidMicros);

  const res = await googleAdsRequest(`/customers/${customerId}/adGroups:mutate`, {
    method: 'POST',
    accessToken,
    loginCustomerId,
    body: { operations: [{ create }] },
  });
  const result = res.results && res.results[0];
  if (!result || !result.resourceName) throw new GoogleAdsApiError('Google Ads did not return an ad group resource name.', { res });
  return result;
}

async function createAdGroupAd({ customerId, accessToken, loginCustomerId, adGroupResourceName, headlines, descriptions, finalUrls }) {
  const res = await googleAdsRequest(`/customers/${customerId}/adGroupAds:mutate`, {
    method: 'POST',
    accessToken,
    loginCustomerId,
    body: {
      operations: [
        {
          create: {
            adGroup: adGroupResourceName,
            status: 'PAUSED',
            ad: {
              finalUrls,
              responsiveSearchAd: {
                headlines: (headlines || []).map((text) => ({ text })),
                descriptions: (descriptions || []).map((text) => ({ text })),
              },
            },
          },
        },
      ],
    },
  });
  const result = res.results && res.results[0];
  if (!result || !result.resourceName) throw new GoogleAdsApiError('Google Ads did not return an ad resource name.', { res });
  return result;
}

// Generic status mutate — Google, unlike Meta's single "/{object-id}" POST,
// uses a distinct :mutate endpoint per resource type, so resourcePath
// ('campaigns' | 'adGroups' | 'adGroupAds') picks which one to hit.
async function updateResourceStatus({ customerId, accessToken, loginCustomerId, resourcePath, resourceName, status }) {
  return googleAdsRequest(`/customers/${customerId}/${resourcePath}:mutate`, {
    method: 'POST',
    accessToken,
    loginCustomerId,
    body: {
      operations: [
        {
          update: { resourceName, status },
          updateMask: 'status',
        },
      ],
    },
  });
}

module.exports = {
  GoogleAdsApiError,
  buildOAuthDialogUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getUserInfo,
  listAccessibleCustomers,
  getCustomerInfo,
  createCampaignBudget,
  createCampaign,
  createAdGroup,
  createAdGroupAd,
  updateResourceStatus,
};
