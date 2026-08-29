const vercel = require('@/utils/vercelClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

function summarizeEnvVar(e) {
  return {
    id: e.id,
    key: e.key,
    value: e.value,
    type: e.type,
    target: Array.isArray(e.target) ? e.target : e.target ? [e.target] : [],
    gitBranch: e.gitBranch,
    comment: e.comment,
    updatedAt: e.updatedAt,
  };
}

// GET /api/vercel/projects/:idOrName/env — "Environment Variables", scoped
// per Production/Preview/Development via each var's `target` array.
const listEnvVars = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const envs = await vercel.listEnvVars({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName });

  return res.status(200).json({ success: true, result: envs.map(summarizeEnvVar), message: 'OK' });
};

// POST /api/vercel/projects/:idOrName/env — Add. Body: { key, value, target:
// ['production','preview','development'], type? }.
const createEnvVar = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const { key, value, target, type } = req.body;
  if (!key || !key.trim() || value === undefined || !Array.isArray(target) || !target.length) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'key, value and at least one target (production/preview/development) are required.',
    });
  }

  const accessToken = decryptedAccessToken(conn);
  const created = await vercel.createEnvVar({
    accessToken,
    teamId: conn.teamId,
    idOrName: req.params.idOrName,
    key: key.trim(),
    value,
    type,
    target,
  });

  const result = created.created || created;
  return res.status(200).json({ success: true, result: summarizeEnvVar(Array.isArray(result) ? result[0] : result), message: 'Environment variable added' });
};

// PATCH /api/vercel/projects/:idOrName/env/:envId — Edit.
const updateEnvVar = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const { key, value, target } = req.body;
  const patch = {};
  if (key !== undefined) patch.key = key;
  if (value !== undefined) patch.value = value;
  if (target !== undefined) patch.target = target;

  const accessToken = decryptedAccessToken(conn);
  const updated = await vercel.updateEnvVar({
    accessToken,
    teamId: conn.teamId,
    idOrName: req.params.idOrName,
    envId: req.params.envId,
    patch,
  });

  return res.status(200).json({ success: true, result: summarizeEnvVar(updated), message: 'Environment variable updated' });
};

// DELETE /api/vercel/projects/:idOrName/env/:envId — Delete.
const deleteEnvVar = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  await vercel.deleteEnvVar({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName, envId: req.params.envId });

  return res.status(200).json({ success: true, result: { id: req.params.envId }, message: 'Environment variable removed' });
};

module.exports = { listEnvVars, createEnvVar, updateEnvVar, deleteEnvVar };
