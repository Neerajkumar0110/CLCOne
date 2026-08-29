const github = require('../../../utils/githubClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

function summarizeRepo(r) {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner && r.owner.login,
    private: r.private,
    fork: r.fork,
    description: r.description,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
    cloneUrl: r.clone_url,
    sshUrl: r.ssh_url,
    stars: r.stargazers_count,
    openIssues: r.open_issues_count,
    language: r.language,
    updatedAt: r.updated_at,
    pushedAt: r.pushed_at,
  };
}

// GET /api/git/repos — "My Repositories": repos this admin's GitHub account owns.
const listMyRepos = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = await getFreshAccessToken(conn);
  const repos = await github.listUserRepos({
    accessToken,
    affiliation: 'owner',
    page: req.query.page || 1,
    perPage: req.query.perPage || 50,
  });

  return res.status(200).json({ success: true, result: repos.map(summarizeRepo), message: 'OK' });
};

// GET /api/git/repos/all — "All Repositories": everything this admin's GitHub
// account can see, including org repos they're a collaborator/member on.
const listAllRepos = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const accessToken = await getFreshAccessToken(conn);
  const repos = await github.listUserRepos({
    accessToken,
    affiliation: 'owner,collaborator,organization_member',
    page: req.query.page || 1,
    perPage: req.query.perPage || 50,
  });

  return res.status(200).json({ success: true, result: repos.map(summarizeRepo), message: 'OK' });
};

// POST /api/git/repos — create a new repository. Body: { name, description?,
// private?, autoInit?, org? }. org creates it under that GitHub org instead
// of the connected user's own account.
const createRepo = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const { name, description, private: isPrivate, autoInit, org } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, result: null, message: 'Repository name is required.' });
  }

  const accessToken = await getFreshAccessToken(conn);
  const repo = await github.createRepo({
    accessToken,
    org,
    name: name.trim(),
    description,
    isPrivate,
    autoInit: autoInit !== false,
  });

  return res.status(200).json({ success: true, result: summarizeRepo(repo), message: 'Repository created' });
};

module.exports = { listMyRepos, listAllRepos, createRepo, summarizeRepo };
