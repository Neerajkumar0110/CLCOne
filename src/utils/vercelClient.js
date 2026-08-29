// Thin wrapper over Vercel's OAuth2 integration flow and REST API
// (api.vercel.com). Uses Node's native fetch (Node >= 18 — see
// googleAdsClient.js). Every function throws VercelApiError with Vercel's
// real error body on failure; nothing here ever fakes a success response.
// Mirrors utils/githubClient.js's shape: one function per API call.
//
// Every authenticated call takes an optional `teamId` — Vercel scopes almost
// everything to a team once the integration was installed on one (installs
// on a personal account never carry a teamId, so it's omitted there).

class VercelApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'VercelApiError';
    this.details = details;
  }
}

// ---- OAuth ----

// External installation flow — see
// https://vercel.com/docs/integrations/create-integration/submit-integration#external-installation-flow.
// Unlike a plain OAuth2 authorize endpoint, the integration's slug (not a
// client_id query param) identifies which app is being installed; Vercel
// echoes `state` straight back on the redirect to VERCEL_REDIRECT_URI.
function buildInstallUrl({ state }) {
  const slug = process.env.VERCEL_INTEGRATION_SLUG;
  const url = new URL(`https://vercel.com/integrations/${slug}/new`);
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCodeForToken({ code, redirectUri }) {
  let res;
  try {
    res = await fetch('https://api.vercel.com/v2/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.VERCEL_CLIENT_ID,
        client_secret: process.env.VERCEL_CLIENT_SECRET,
        redirect_uri: redirectUri,
      }).toString(),
    });
  } catch (networkErr) {
    throw new VercelApiError(`Could not reach Vercel's OAuth token endpoint: ${networkErr.message}`, { networkErr: true });
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new VercelApiError(json.error_description || json.error || `OAuth token request failed with status ${res.status}`, {
      status: res.status,
      error: json.error,
    });
  }
  return json; // { access_token, token_type, installation_id, user_id, team_id? }
}

// ---- Low-level request helper ----

async function vercelRequest(path, { method = 'GET', body, accessToken, teamId, params } = {}) {
  if (!accessToken) throw new VercelApiError('No Vercel access token supplied.');

  const url = new URL(path.startsWith('http') ? path : `https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url.toString(), init);
  } catch (networkErr) {
    throw new VercelApiError(`Could not reach Vercel API: ${networkErr.message}`, { networkErr: true });
  }

  const text = await res.text();
  const json = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const errBody = json.error || json;
    throw new VercelApiError(errBody.message || `Vercel API request failed with status ${res.status}`, {
      status: res.status,
      code: errBody.code,
    });
  }

  return json;
}

// ---- Identity ----

async function getAuthenticatedUser(accessToken) {
  const res = await vercelRequest('/v2/user', { accessToken });
  return res.user;
}

// ---- Projects ----

async function listProjects({ accessToken, teamId, search }) {
  const res = await vercelRequest('/v10/projects', { accessToken, teamId, params: { search, limit: 100 } });
  return Array.isArray(res) ? res : res.projects;
}

async function getProject({ accessToken, teamId, idOrName }) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(idOrName)}`, { accessToken, teamId });
}

// gitRepository: { type: 'github', repo: 'owner/name' } — connects the new
// project to a repo the connected GitHub account (Git Management) can see.
async function createProject({ accessToken, teamId, name, gitRepository }) {
  return vercelRequest('/v11/projects', {
    method: 'POST',
    accessToken,
    teamId,
    body: { name, gitRepository },
  });
}

async function listProjectDomains({ accessToken, teamId, idOrName }) {
  const res = await vercelRequest(`/v9/projects/${encodeURIComponent(idOrName)}/domains`, { accessToken, teamId });
  return res.domains || [];
}

async function addProjectDomain({ accessToken, teamId, idOrName, name }) {
  return vercelRequest(`/v10/projects/${encodeURIComponent(idOrName)}/domains`, {
    method: 'POST',
    accessToken,
    teamId,
    body: { name },
  });
}

async function removeProjectDomain({ accessToken, teamId, idOrName, domain }) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(idOrName)}/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    accessToken,
    teamId,
  });
}

// ---- Environment variables ----

async function listEnvVars({ accessToken, teamId, idOrName }) {
  const res = await vercelRequest(`/v10/projects/${encodeURIComponent(idOrName)}/env`, {
    accessToken,
    teamId,
    params: { decrypt: 'true' },
  });
  return res.envs || (Array.isArray(res) ? res : []);
}

async function createEnvVar({ accessToken, teamId, idOrName, key, value, type, target }) {
  return vercelRequest(`/v10/projects/${encodeURIComponent(idOrName)}/env`, {
    method: 'POST',
    accessToken,
    teamId,
    params: { upsert: 'true' },
    body: { key, value, type: type || 'encrypted', target },
  });
}

async function updateEnvVar({ accessToken, teamId, idOrName, envId, patch }) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(idOrName)}/env/${encodeURIComponent(envId)}`, {
    method: 'PATCH',
    accessToken,
    teamId,
    body: patch,
  });
}

async function deleteEnvVar({ accessToken, teamId, idOrName, envId }) {
  return vercelRequest(`/v9/projects/${encodeURIComponent(idOrName)}/env/${encodeURIComponent(envId)}`, {
    method: 'DELETE',
    accessToken,
    teamId,
  });
}

// ---- Deployments ----

async function listDeployments({ accessToken, teamId, projectId, limit = 30 }) {
  const res = await vercelRequest('/v7/deployments', { accessToken, teamId, params: { projectId, limit } });
  return res.deployments || [];
}

async function getDeployment({ accessToken, teamId, idOrUrl }) {
  return vercelRequest(`/v13/deployments/${encodeURIComponent(idOrUrl)}`, { accessToken, teamId });
}

async function getDeploymentEvents({ accessToken, teamId, idOrUrl, limit = 300 }) {
  const res = await vercelRequest(`/v3/deployments/${encodeURIComponent(idOrUrl)}/events`, {
    accessToken,
    teamId,
    params: { limit, direction: 'forward' },
  });
  return Array.isArray(res) ? res : [];
}

// Deploy the latest commit for a project (finds its most recent deployment
// and redeploys with withLatestCommit so the build picks up new commits),
// or redeploy an exact past deployment when deploymentId is passed directly.
async function createDeployment({ accessToken, teamId, name, project, deploymentId, withLatestCommit, target }) {
  return vercelRequest('/v13/deployments', {
    method: 'POST',
    accessToken,
    teamId,
    body: { name, project, deploymentId, withLatestCommit, target },
  });
}

async function cancelDeployment({ accessToken, teamId, id }) {
  return vercelRequest(`/v12/deployments/${encodeURIComponent(id)}/cancel`, {
    method: 'PATCH',
    accessToken,
    teamId,
  });
}

async function rollback({ accessToken, teamId, projectId, deploymentId, description }) {
  return vercelRequest(`/v1/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentId)}`, {
    method: 'POST',
    accessToken,
    teamId,
    params: { description },
  });
}

module.exports = {
  VercelApiError,
  buildInstallUrl,
  exchangeCodeForToken,
  getAuthenticatedUser,
  listProjects,
  getProject,
  createProject,
  listProjectDomains,
  addProjectDomain,
  removeProjectDomain,
  listEnvVars,
  createEnvVar,
  updateEnvVar,
  deleteEnvVar,
  listDeployments,
  getDeployment,
  getDeploymentEvents,
  createDeployment,
  cancelDeployment,
  rollback,
};
