const connect = require('./connect');
const callback = require('./callback');
const { getConnection, disconnectConnection } = require('./connection');
const { listMyRepos, listAllRepos, createRepo } = require('./repos');
const {
  getRepoDetail,
  listBranches,
  listCommits,
  listPulls,
  listIssues,
  listReleases,
  listActivity,
} = require('./repoDetails');

module.exports = {
  connect,
  callback,
  getConnection,
  disconnectConnection,
  listMyRepos,
  listAllRepos,
  createRepo,
  getRepoDetail,
  listBranches,
  listCommits,
  listPulls,
  listIssues,
  listReleases,
  listActivity,
};
