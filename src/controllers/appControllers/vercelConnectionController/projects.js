const vercel = require('../../../utils/vercelClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

function summarizeProject(p) {
  return {
    id: p.id,
    name: p.name,
    framework: p.framework,
    link: p.link
      ? {
          type: p.link.type,
          repo: p.link.repo || (p.link.org && p.link.repo ? `${p.link.org}/${p.link.repo}` : undefined),
          org: p.link.org,
          productionBranch: p.link.productionBranch,
        }
      : null,
    productionUrl: Array.isArray(p.alias) && p.alias.length ? p.alias[0] : p.targets?.production?.alias?.[0],
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
  };
}

// GET /api/vercel/projects — "Vercel Projects" list for the connected account/team.
const listProjects = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const projects = await vercel.listProjects({ accessToken, teamId: conn.teamId, search: req.query.search });

  return res.status(200).json({ success: true, result: projects.map(summarizeProject), message: 'OK' });
};

// GET /api/vercel/projects/:idOrName
const getProject = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = decryptedAccessToken(conn);
  const project = await vercel.getProject({ accessToken, teamId: conn.teamId, idOrName: req.params.idOrName });

  return res.status(200).json({ success: true, result: summarizeProject(project), message: 'OK' });
};

// POST /api/vercel/projects — "Git repository select": body.repo (the
// "owner/name" of a repo the connected GitHub account can see, from Git
// Management) links the new Vercel project to it so pushes auto-deploy.
const createProject = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const { name, repo } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, result: null, message: 'Project name is required.' });
  }

  const accessToken = decryptedAccessToken(conn);
  const project = await vercel.createProject({
    accessToken,
    teamId: conn.teamId,
    name: name.trim(),
    gitRepository: repo ? { type: 'github', repo } : undefined,
  });

  return res.status(200).json({ success: true, result: summarizeProject(project), message: 'Project created' });
};

module.exports = { listProjects, getProject, createProject, summarizeProject };
