const mongoose = require('mongoose');
const client = require('../../../utils/linkedinAdsClient');
const { findConnection, sanitizeConnection, decryptedAccessToken } = require('./_helpers');

// GET /api/linkedin/connection — real status, never a hard-coded boolean.
// Mirrors facebookController/connection.js's getConnection.
const getConnection = async (req, res) => {
  const conn = await findConnection();
  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'OK' });
};

// PATCH /api/linkedin/connection — select an Organization ({ organizationId,
// organizationName }, LinkedIn's parallel to Facebook's Page selection — the
// Organization owns whichever Lead Gen Forms linkedinLeadPoller.js polls) or
// an Ad Account ({ adAccountId, adAccountName }). Unlike Facebook's Page
// flow, there's no per-Organization access token to fetch and store — the
// single member-level accessToken from callback.js is used everywhere.
const updateConnection = async (req, res) => {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected') {
    return res.status(400).json({ success: false, result: null, message: 'LinkedIn is not connected yet.' });
  }

  const { organizationId, organizationName, adAccountId, adAccountName } = req.body;

  try {
    if (organizationId) {
      const accessToken = decryptedAccessToken(conn);
      const acls = await client.getOrganizationAcls(accessToken);
      const match = acls.find((a) => (a.organization || '').endsWith(`:${organizationId}`) || a.organizationTarget === organizationId);
      if (!match) {
        return res.status(400).json({ success: false, result: null, message: 'That Organization was not found for this account.' });
      }
      conn.organizationId = organizationId;
      conn.organizationName = organizationName;
    }

    if (adAccountId) {
      conn.adAccountId = adAccountId;
      conn.adAccountName = adAccountName;
    }

    conn.updated = Date.now();
    await conn.save();

    return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'Connection updated' });
  } catch (err) {
    conn.lastError = err.message;
    await conn.save();
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

// DELETE /api/linkedin/connection — best-effort token revoke, then mark
// disconnected and wipe tokens. Leads already saved are never touched.
// Mirrors facebookController/connection.js's disconnectConnection; LinkedIn
// has no webhook subscription to tear down (see linkedinLeadPoller.js), so
// the only best-effort cleanup call here is the token revoke itself.
const disconnectConnection = async (req, res) => {
  const conn = await findConnection();
  if (!conn) {
    return res.status(200).json({ success: true, result: sanitizeConnection(null), message: 'Already disconnected' });
  }

  if (conn.accessToken) {
    try {
      await client.revokeToken(decryptedAccessToken(conn));
    } catch (err) {
      // Best-effort — still proceed to disconnect locally.
      conn.lastError = `Token revoke failed: ${err.message}`;
    }
  }

  conn.status = 'disconnected';
  conn.accessToken = undefined;
  conn.updated = Date.now();
  await conn.save();

  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'LinkedIn disconnected' });
};

module.exports = { getConnection, updateConnection, disconnectConnection };
