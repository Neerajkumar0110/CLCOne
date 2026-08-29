const vercel = require('@/utils/vercelClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

function summarizeDomain(d) {
  return {
    name: d.name,
    verified: d.verified,
    apexName: d.apexName,
    createdAt: d.createdAt,
  };
}

// GET /api/vercel/projects/:idOrName/domains — "Domains".
const listDomains = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const domains = await vercel.listProjectDomains({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName });

  return res.status(200).json({ success: true, result: domains.map(summarizeDomain), message: 'OK' });
};

// POST /api/vercel/projects/:idOrName/domains — Body: { name }.
const addDomain = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, result: null, message: 'Domain name is required.' });
  }

  const accessToken = decryptedAccessToken(conn);
  const domain = await vercel.addProjectDomain({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName, name: name.trim() });

  return res.status(200).json({ success: true, result: summarizeDomain(domain), message: 'Domain added' });
};

// DELETE /api/vercel/projects/:idOrName/domains/:domain
const removeDomain = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  await vercel.removeProjectDomain({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName, domain: req.params.domain });

  return res.status(200).json({ success: true, result: { name: req.params.domain }, message: 'Domain removed' });
};

module.exports = { listDomains, addDomain, removeDomain };
