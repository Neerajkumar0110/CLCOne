// Thin wrapper over GitHub's OAuth 2.0 web flow and the GitHub REST API
// (api.github.com). Uses Node's native fetch (Node >= 18, already required
// elsewhere in this app — see googleAdsClient.js). Every function throws
// GitHubApiError with GitHub's real error body on failure; nothing here ever
// fakes a success response. Mirrors utils/googleAdsClient.js's shape: one
// function per API call, uniform error type.

const API_VERSION = '2022-11-28';

class GitHubApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'GitHubApiError';
    this.details = details;
  }
}

// ---- OAuth ----

function buildOAuthDialogUrl({ redirectUri, state, scope }) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

async function exchangeCodeForToken({ code, redirectUri }) {
  let res;
  try {
    res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
  } catch (networkErr) {
    throw new GitHubApiError(`Could not reach GitHub's OAuth token endpoint: ${networkErr.message}`, { networkErr: true });
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.error) {
    throw new GitHubApiError(json.error_description || json.error || `OAuth token request failed with status ${res.status}`, {
      status: res.status,
      error: json.error,
    });
  }

  return json; // { access_token, token_type, scope, refresh_token?, expires_in? }
}

async function refreshAccessToken({ refreshToken }) {
  let res;
  try {
    res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
  } catch (networkErr) {
    throw new GitHubApiError(`Could not reach GitHub's OAuth token endpoint: ${networkErr.message}`, { networkErr: true });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new GitHubApiError(json.error_description || json.error || `Token refresh failed with status ${res.status}`, {
      status: res.status,
      error: json.error,
    });
  }
  return json;
}

// ---- REST API ----

async function githubRequest(path, { method = 'GET', body, accessToken, params } = {}) {
  if (!accessToken) throw new GitHubApiError('No GitHub access token supplied.');

  const url = new URL(path.startsWith('http') ? path : `https://api.github.com${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url.toString(), init);
  } catch (networkErr) {
    throw new GitHubApiError(`Could not reach GitHub API: ${networkErr.message}`, { networkErr: true });
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    throw new GitHubApiError(json.message || `GitHub API request failed with status ${res.status}`, {
      status: res.status,
      errors: json.errors,
    });
  }

  return json;
}

async function getAuthenticatedUser(accessToken) {
  return githubRequest('/user', { accessToken });
}

// affiliation: 'owner' for "My Repositories", 'owner,collaborator,organization_member'
// for "All Repositories" (everything this account can see, org repos included).
async function listUserRepos({ accessToken, affiliation = 'owner', page = 1, perPage = 50 }) {
  return githubRequest('/user/repos', {
    accessToken,
    params: { affiliation, sort: 'updated', direction: 'desc', per_page: perPage, page },
  });
}

async function createRepo({ accessToken, org, name, description, isPrivate, autoInit }) {
  const path = org ? `/orgs/${encodeURIComponent(org)}/repos` : '/user/repos';
  return githubRequest(path, {
    method: 'POST',
    accessToken,
    body: { name, description, private: !!isPrivate, auto_init: !!autoInit },
  });
}

async function getRepo({ accessToken, owner, repo }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { accessToken });
}

async function listBranches({ accessToken, owner, repo, page = 1, perPage = 50 }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, {
    accessToken,
    params: { per_page: perPage, page },
  });
}

async function listCommits({ accessToken, owner, repo, sha, page = 1, perPage = 30 }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`, {
    accessToken,
    params: { sha, per_page: perPage, page },
  });
}

async function listPulls({ accessToken, owner, repo, state = 'all', page = 1, perPage = 30 }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    accessToken,
    params: { state, sort: 'updated', direction: 'desc', per_page: perPage, page },
  });
}

// GitHub's /issues endpoint also returns pull requests (they share the same
// underlying object) — callers wanting "real" issues only should filter out
// entries carrying a `pull_request` key.
async function listIssues({ accessToken, owner, repo, state = 'all', page = 1, perPage = 30 }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`, {
    accessToken,
    params: { state, sort: 'updated', direction: 'desc', per_page: perPage, page },
  });
}

async function listReleases({ accessToken, owner, repo, page = 1, perPage = 30 }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases`, {
    accessToken,
    params: { per_page: perPage, page },
  });
}

async function listActivity({ accessToken, owner, repo, page = 1, perPage = 30 }) {
  return githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/events`, {
    accessToken,
    params: { per_page: perPage, page },
  });
}

module.exports = {
  GitHubApiError,
  buildOAuthDialogUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  getAuthenticatedUser,
  listUserRepos,
  createRepo,
  getRepo,
  listBranches,
  listCommits,
  listPulls,
  listIssues,
  listReleases,
  listActivity,
};
