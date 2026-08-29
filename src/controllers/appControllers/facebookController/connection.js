const mongoose = require('mongoose');
const graph = require('../../../utils/metaGraphClient');
const tokenCrypto = require('../../../utils/metaTokenCrypto');
const { findConnection, sanitizeConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/connection — real status, never a hard-coded boolean.
const getConnection = async (req, res) => {
  const conn = await findConnection();
  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'OK' });
};

// PATCH /api/facebook/connection — select a Page ({ pageId }) or an Ad
// Account ({ adAccountId, adAccountName }). Selecting a Page re-fetches
// /me/accounts to get that page's own access token (Meta only returns it
// bundled in the pages list, not separately) and stores it encrypted.
const updateConnection = async (req, res) => {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected') {
    return res.status(400).json({ success: false, result: null, message: 'Facebook is not connected yet.' });
  }

  const { pageId, adAccountId, adAccountName } = req.body;

  try {
    if (pageId) {
      const userToken = decryptedUserToken(conn);
      const pages = await graph.getPages(userToken);
      const page = pages.find((p) => p.id === pageId);
      if (!page) {
        return res.status(400).json({ success: false, result: null, message: 'That Page was not found for this account.' });
      }
      conn.pageId = page.id;
      conn.pageName = page.name;
      conn.pageAccessToken = tokenCrypto.encrypt(page.access_token);
      conn.webhookSubscribed = false; // re-subscribe needed for the newly selected page

      try {
        await graph.subscribePageWebhook({ pageId: page.id, pageAccessToken: page.access_token });
        conn.webhookSubscribed = true;
      } catch (subErr) {
        // Page selection itself still succeeded — surface the subscription
        // failure separately rather than failing the whole request.
        conn.lastError = `Webhook subscription failed: ${subErr.message}`;
      }
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

// DELETE /api/facebook/connection — best-effort webhook unsubscribe, then
// mark disconnected and wipe tokens. Leads already saved are never touched.
const disconnectConnection = async (req, res) => {
  const conn = await findConnection();
  if (!conn) {
    return res.status(200).json({ success: true, result: sanitizeConnection(null), message: 'Already disconnected' });
  }

  if (conn.webhookSubscribed && conn.pageId && conn.pageAccessToken) {
    try {
      const pageToken = tokenCrypto.decrypt(conn.pageAccessToken);
      await fetch(
        `https://graph.facebook.com/${process.env.META_API_VERSION}/${conn.pageId}/subscribed_apps?access_token=${encodeURIComponent(pageToken)}`,
        { method: 'DELETE' }
      );
    } catch (err) {
      // Best-effort — still proceed to disconnect locally.
      conn.lastError = `Webhook unsubscribe failed: ${err.message}`;
    }
  }

  conn.status = 'disconnected';
  conn.webhookSubscribed = false;
  conn.pageAccessToken = undefined;
  conn.userAccessToken = undefined;
  conn.updated = Date.now();
  await conn.save();

  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'Facebook disconnected' });
};

module.exports = { getConnection, updateConnection, disconnectConnection };
