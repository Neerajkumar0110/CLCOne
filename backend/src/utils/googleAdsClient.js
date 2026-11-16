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
    // Google's top-level message is often generic ("Request is missing required
    // authentication credential…"); the real reason sits in details[].errors[].
    const adsErrors = []
      .concat(...(errBody.details || []).map((d) => d.errors || []))
      .filter(Boolean);
    const first = adsErrors[0];
    const code = first && first.errorCode ? Object.values(first.errorCode)[0] : null;
    const FRIENDLY = {
      NOT_ADS_USER:
        "This Google login has no Google Ads account. Connect with the email that can open your Google Ads account (ads.google.com), or invite this email in Google Ads → Admin → Access and security.",
      DEVELOPER_TOKEN_NOT_APPROVED:
        'The Google Ads developer token is test-only — apply for Basic access in Google Ads → Tools → API Center to read real accounts.',
      USER_PERMISSION_DENIED:
        "This Google login can't open that Google Ads account — it may sit under a manager account, or access was removed.",
      CUSTOMER_NOT_ENABLED: 'That Google Ads account is not active (cancelled or not set up yet).',
    };
    const message = (code && FRIENDLY[code]) || (first && first.message) || errBody.message || `Google Ads API request failed with status ${res.status}`;
    throw new GoogleAdsApiError(message, {
      adsErrorCode: code,
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

// Every Google Ads account this login can reach — the ones it was invited to
// directly AND the client accounts under any manager (MCC) account it can
// reach (listAccessibleCustomers alone never returns those, yet that is where
// the campaigns usually run). Each row carries the loginCustomerId Google needs
// on the header to query it: the account itself when reached directly, the
// manager when reached through one. Never throws for one bad account — that
// row gets an `error` instead.
async function listAdAccounts(accessToken) {
  const ids = await listAccessibleCustomers(accessToken);
  const out = new Map();
  const add = (row) => {
    const prev = out.get(row.customerId);
    if (!prev || (prev.error && !row.error)) out.set(row.customerId, row);
  };
  await Promise.all(
    ids.map(async (id) => {
      let me;
      try {
        const res = await googleAdsRequest(`/customers/${id}/googleAds:search`, {
          method: 'POST',
          accessToken,
          loginCustomerId: id,
          body: { query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status, customer.manager FROM customer LIMIT 1' },
        });
        me = (res.results && res.results[0] && res.results[0].customer) || {};
      } catch (err) {
        add({ customerId: id, name: id, direct: true, manager: false, loginCustomerId: id, error: err.message });
        return;
      }
      add({
        customerId: id,
        name: me.descriptiveName || id,
        currency: me.currencyCode,
        status: me.status,
        manager: !!me.manager,
        direct: true,
        loginCustomerId: id,
      });
      if (!me.manager) return;
      try {
        const rows = await searchAll({
          customerId: id,
          accessToken,
          loginCustomerId: id,
          query:
            'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.status, ' +
            'customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level > 0',
        });
        for (const r of rows) {
          const c = r.customerClient || {};
          if (!c.id) continue;
          add({
            customerId: String(c.id),
            name: c.descriptiveName || String(c.id),
            currency: c.currencyCode,
            status: c.status,
            manager: !!c.manager,
            direct: false,
            loginCustomerId: id,
            managerName: me.descriptiveName || id,
          });
        }
      } catch (err) {
        const m = out.get(id);
        if (m) m.error = `Could not list the accounts under this manager: ${err.message}`;
      }
    })
  );
  return [...out.values()];
}

// GAQL search across every page of results (googleAds:search pages by
// nextPageToken). Read-only. Rows come back camelCased, e.g. r.campaign.name.
async function searchAll({ customerId, accessToken, loginCustomerId, query, maxPages = 20 }) {
  const rows = [];
  let pageToken;
  for (let i = 0; i < maxPages; i += 1) {
    const res = await googleAdsRequest(`/customers/${customerId}/googleAds:search`, {
      method: 'POST',
      accessToken,
      loginCustomerId: loginCustomerId || customerId,
      body: pageToken ? { query, pageToken } : { query },
    });
    rows.push(...(res.results || []));
    if (!res.nextPageToken) break;
    pageToken = res.nextPageToken;
  }
  return rows;
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
  listAdAccounts,
  searchAll,
  createCampaignBudget,
  createCampaign,
  createAdGroup,
  createAdGroupAd,
  updateResourceStatus,
};
