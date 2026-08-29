const connect = require('./connect');
const callback = require('./callback');
const { getConnection, updateConnection, disconnectConnection } = require('./connection');
const getAdAccounts = require('./adAccounts');
const {
  listCampaignGroups,
  readCampaignGroup,
  createCampaignGroup,
  updateCampaignGroup,
  publishCampaignGroup,
} = require('./campaignGroups');
const { listCampaigns, createCampaign, updateCampaign, publishCampaign } = require('./campaigns');
const { listCreatives, createCreative, updateCreative, publishCreative } = require('./creatives');
const { getSyncLogs, triggerSync } = require('./leadSync');

module.exports = {
  connect,
  callback,
  getConnection,
  updateConnection,
  disconnectConnection,
  getAdAccounts,
  listCampaignGroups,
  readCampaignGroup,
  createCampaignGroup,
  updateCampaignGroup,
  publishCampaignGroup,
  listCampaigns,
  createCampaign,
  updateCampaign,
  publishCampaign,
  listCreatives,
  createCreative,
  updateCreative,
  publishCreative,
  getSyncLogs,
  triggerSync,
};
