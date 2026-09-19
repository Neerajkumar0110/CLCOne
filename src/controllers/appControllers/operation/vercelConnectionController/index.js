const connect = require('./connect');
const callback = require('./callback');
const { getConnection, disconnectConnection } = require('./connection');
const { listProjects, getProject, createProject } = require('./projects');
const {
  listDeployments,
  getDeployment,
  getBuildLogs,
  deployLatest,
  redeploy,
  cancelDeployment,
  rollback,
} = require('./deployments');
const { listEnvVars, createEnvVar, updateEnvVar, deleteEnvVar } = require('./envVars');
const { listDomains, addDomain, removeDomain } = require('./domains');

module.exports = {
  connect,
  callback,
  getConnection,
  disconnectConnection,
  listProjects,
  getProject,
  createProject,
  listDeployments,
  getDeployment,
  getBuildLogs,
  deployLatest,
  redeploy,
  cancelDeployment,
  rollback,
  listEnvVars,
  createEnvVar,
  updateEnvVar,
  deleteEnvVar,
  listDomains,
  addDomain,
  removeDomain,
};
