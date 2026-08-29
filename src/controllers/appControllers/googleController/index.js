const connect = require('./connect');
const callback = require('./callback');
const { getConnection, updateConnection, disconnectConnection } = require('./connection');
const getCustomerAccounts = require('./customerAccounts');
const { listCampaigns, readCampaign, createCampaign, updateCampaign, publishCampaign } = require('./campaigns');
const { listAdGroups, createAdGroup, updateAdGroup } = require('./adgroups');
const { listAds, createAd, updateAd, publishAd } = require('./ads');
const { receiveWebhook } = require('./webhook');

module.exports = {
  connect,
  callback,
  getConnection,
  updateConnection,
  disconnectConnection,
  getCustomerAccounts,
  listCampaigns,
  readCampaign,
  createCampaign,
  updateCampaign,
  publishCampaign,
  listAdGroups,
  createAdGroup,
  updateAdGroup,
  listAds,
  createAd,
  updateAd,
  publishAd,
  receiveWebhook,
};
