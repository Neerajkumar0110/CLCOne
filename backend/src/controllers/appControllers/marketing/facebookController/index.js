const connect = require('./connect');
const callback = require('./callback');
const { getConnection, updateConnection, disconnectConnection } = require('./connection');
const getPages = require('./pages');
const getAdAccounts = require('./adAccounts');
const { getForms, createForm } = require('./forms');
const { listCampaigns, readCampaign, createCampaign, updateCampaign, publishCampaign } = require('./campaigns');
const { listAdSets, createAdSet, updateAdSet } = require('./adsets');
const { listCreatives, createCreative } = require('./creatives');
const { listAds, createAd, updateAd, publishAd } = require('./ads');
const { verifyWebhook, receiveWebhook } = require('./webhook');

module.exports = {
  connect,
  callback,
  getConnection,
  updateConnection,
  disconnectConnection,
  getPages,
  getAdAccounts,
  getForms,
  createForm,
  listCampaigns,
  readCampaign,
  createCampaign,
  updateCampaign,
  publishCampaign,
  listAdSets,
  createAdSet,
  updateAdSet,
  listCreatives,
  createCreative,
  listAds,
  createAd,
  updateAd,
  publishAd,
  verifyWebhook,
  receiveWebhook,
};
