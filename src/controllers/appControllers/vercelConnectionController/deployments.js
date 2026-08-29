const vercel = require('@/utils/vercelClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

function summarizeDeployment(d) {
  return {
    id: d.uid || d.id,
    name: d.name,
    url: d.url,
    inspectorUrl: d.inspectorUrl,
    state: d.readyState || d.state,
    target: d.target,
    source: d.source,
    createdAt: d.createdAt || d.created,
    creator: d.creator && (d.creator.username || d.creator.uid),
    meta: d.meta,
    errorMessage: d.errorMessage,
  };
}

// GET /api/vercel/projects/:idOrName/deployments — "Deployment history" /
// "Deployment status", and doubles as the "Activity" feed (Vercel's Audit
// Log API is Enterprise-only and not generally available, so deployment
// history — who deployed what, when, and the result — is the real activity
// trail this plan can actually see).
const listDeployments = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const deployments = await vercel.listDeployments({
    accessToken,
    teamId: conn.teamId,
    projectId: req.params.idOrName,
    limit: req.query.limit || 30,
  });

  return res.status(200).json({ success: true, result: deployments.map(summarizeDeployment), message: 'OK' });
};

// GET /api/vercel/deployments/:id
const getDeployment = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const deployment = await vercel.getDeployment({ accessToken, teamId: conn.teamId, idOrUrl: req.params.id });

  return res.status(200).json({ success: true, result: summarizeDeployment(deployment), message: 'OK' });
};

// GET /api/vercel/deployments/:id/logs — "Build logs".
const getBuildLogs = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const events = await vercel.getDeploymentEvents({ accessToken, teamId: conn.teamId, idOrUrl: req.params.id });

  const result = events
    .filter((e) => e && (e.text || e.payload?.text))
    .map((e) => ({
      type: e.type,
      level: e.level,
      text: e.text || e.payload?.text,
      date: e.date || e.created,
    }));

  return res.status(200).json({ success: true, result, message: 'OK' });
};

// POST /api/vercel/projects/:idOrName/deploy — "Deploy": builds the latest
// commit for this project. Finds the project's most recent deployment and
// redeploys it with withLatestCommit so the new build actually picks up
// whatever has been pushed since, inheriting the rest of its settings.
const deployLatest = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const project = await vercel.getProject({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName });
  const recent = await vercel.listDeployments({ accessToken, teamId: conn.teamId, projectId: project.id, limit: 1 });

  if (!recent.length) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'This project has no prior deployments to build from yet — push to its connected repo, or deploy it from the Vercel CLI first.',
    });
  }

  const deployment = await vercel.createDeployment({
    accessToken,
    teamId: conn.teamId,
    name: project.name,
    project: project.id,
    deploymentId: recent[0].uid,
    withLatestCommit: true,
    target: req.body?.target,
  });

  return res.status(200).json({ success: true, result: summarizeDeployment(deployment), message: 'Deployment triggered' });
};

// POST /api/vercel/deployments/:id/redeploy — "Redeploy" an exact past
// deployment (same commit/build inputs it originally used).
const redeploy = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const original = await vercel.getDeployment({ accessToken, teamId: conn.teamId, idOrUrl: req.params.id });

  const deployment = await vercel.createDeployment({
    accessToken,
    teamId: conn.teamId,
    name: original.name,
    project: original.projectId || original.project?.id,
    deploymentId: original.id || original.uid,
    target: original.target,
  });

  return res.status(200).json({ success: true, result: summarizeDeployment(deployment), message: 'Redeploy triggered' });
};

// POST /api/vercel/deployments/:id/cancel
const cancelDeployment = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const deployment = await vercel.cancelDeployment({ accessToken, teamId: conn.teamId, id: req.params.id });

  return res.status(200).json({ success: true, result: summarizeDeployment(deployment), message: 'Deployment canceled' });
};

// POST /api/vercel/projects/:idOrName/rollback/:deploymentId — "Rollback":
// points production traffic at a previous production deployment.
const rollback = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  await vercel.rollback({
    accessToken,
    teamId: conn.teamId,
    projectId: req.params.idOrName,
    deploymentId: req.params.deploymentId,
    description: req.body?.description,
  });

  return res.status(200).json({ success: true, result: { rolledBackTo: req.params.deploymentId }, message: 'Rollback started' });
};

module.exports = {
  listDeployments,
  getDeployment,
  getBuildLogs,
  deployLatest,
  redeploy,
  cancelDeployment,
  rollback,
  summarizeDeployment,
};
