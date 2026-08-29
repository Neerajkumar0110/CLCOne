const github = require('../../../utils/githubClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');
const { summarizeRepo } = require('./repos');

// Every handler below reads { owner, repo } from the URL and forwards
// req.query straight to the matching GitHub REST endpoint via utils/githubClient.js.

// GET /api/git/repos/:owner/:repo — repo detail, including clone/pull/push URLs.
const getRepoDetail = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const repo = await github.getRepo({ accessToken, owner: req.params.owner, repo: req.params.repo });
  return res.status(200).json({ success: true, result: summarizeRepo(repo), message: 'OK' });
};

// GET /api/git/repos/:owner/:repo/branches
const listBranches = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const branches = await github.listBranches({
    accessToken,
    owner: req.params.owner,
    repo: req.params.repo,
    page: req.query.page,
    perPage: req.query.perPage,
  });
  const result = branches.map((b) => ({ name: b.name, protected: b.protected, sha: b.commit && b.commit.sha }));
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/git/repos/:owner/:repo/commits?sha=branch
const listCommits = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const commits = await github.listCommits({
    accessToken,
    owner: req.params.owner,
    repo: req.params.repo,
    sha: req.query.branch,
    page: req.query.page,
    perPage: req.query.perPage,
  });
  const result = commits.map((c) => ({
    sha: c.sha,
    message: c.commit && c.commit.message,
    author: (c.commit && c.commit.author && c.commit.author.name) || (c.author && c.author.login),
    authorAvatar: c.author && c.author.avatar_url,
    date: c.commit && c.commit.author && c.commit.author.date,
    htmlUrl: c.html_url,
  }));
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/git/repos/:owner/:repo/pulls?state=all|open|closed
const listPulls = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const pulls = await github.listPulls({
    accessToken,
    owner: req.params.owner,
    repo: req.params.repo,
    state: req.query.state || 'all',
    page: req.query.page,
    perPage: req.query.perPage,
  });
  const result = pulls.map((p) => ({
    number: p.number,
    title: p.title,
    state: p.state,
    draft: p.draft,
    user: p.user && p.user.login,
    userAvatar: p.user && p.user.avatar_url,
    base: p.base && p.base.ref,
    head: p.head && p.head.ref,
    htmlUrl: p.html_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    mergedAt: p.merged_at,
  }));
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/git/repos/:owner/:repo/issues?state=all|open|closed — GitHub's
// /issues endpoint also returns pull requests, filtered out here so this is
// real issues only (Pull Requests has its own tab/endpoint above).
const listIssues = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const issues = await github.listIssues({
    accessToken,
    owner: req.params.owner,
    repo: req.params.repo,
    state: req.query.state || 'all',
    page: req.query.page,
    perPage: req.query.perPage,
  });
  const result = issues
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      user: i.user && i.user.login,
      userAvatar: i.user && i.user.avatar_url,
      labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
      comments: i.comments,
      htmlUrl: i.html_url,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    }));
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/git/repos/:owner/:repo/releases
const listReleases = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const releases = await github.listReleases({
    accessToken,
    owner: req.params.owner,
    repo: req.params.repo,
    page: req.query.page,
    perPage: req.query.perPage,
  });
  const result = releases.map((r) => ({
    name: r.name || r.tag_name,
    tagName: r.tag_name,
    draft: r.draft,
    prerelease: r.prerelease,
    author: r.author && r.author.login,
    htmlUrl: r.html_url,
    publishedAt: r.published_at,
  }));
  return res.status(200).json({ success: true, result, message: 'OK' });
};

// GET /api/git/repos/:owner/:repo/activity — recent repo events (pushes,
// PRs, issues, stars, forks...).
const listActivity = async (req, res) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const accessToken = await getFreshAccessToken(conn);
  const events = await github.listActivity({
    accessToken,
    owner: req.params.owner,
    repo: req.params.repo,
    page: req.query.page,
    perPage: req.query.perPage,
  });
  const result = events.map((e) => ({
    id: e.id,
    type: e.type,
    actor: e.actor && e.actor.login,
    actorAvatar: e.actor && e.actor.avatar_url,
    createdAt: e.created_at,
  }));
  return res.status(200).json({ success: true, result, message: 'OK' });
};

module.exports = {
  getRepoDetail,
  listBranches,
  listCommits,
  listPulls,
  listIssues,
  listReleases,
  listActivity,
};
