const graph = require('../../../utils/googleAdsClient');
const { findConnection, sanitizeConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/connection — real status, never a hard-coded boolean.
// result.webhookUrl/result.webhookKey are what the frontend shows the admin
// to paste into the Google Ads UI's Lead form webhook config.
const getConnection = async (req, res) => {
  const conn = await findConnection();
  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'OK' });
};

// PATCH /api/google/connection — select a Google Ads account
// ({ customerId, customerName, loginCustomerId }). loginCustomerId is only
// needed when customerId is a client account managed under a manager (MCC)
// account — Google requires it on the login-customer-id header for those
// calls. Validates the account is actually accessible with this connection
// before saving it.
const updateConnection = async (req, res) => {
  const conn = await findConnection();
  if (!conn || conn.status !== 'connected') {
    return res.status(400).json({ success: false, result: null, message: 'Google Ads is not connected yet.' });
  }

  const { customerId, customerName, loginCustomerId } = req.body;

  try {
    if (customerId) {
      const accessToken = await getFreshAccessToken(conn);
      const accessible = await graph.listAccessibleCustomers(accessToken);
      if (!accessible.includes(customerId)) {
        return res.status(400).json({ success: false, result: null, message: 'That Google Ads account is not accessible with this connection.' });
      }
      conn.customerId = customerId;
      conn.customerName = customerName;
      conn.loginCustomerId = loginCustomerId || undefined;
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

// DELETE /api/google/connection — wipes tokens and marks disconnected.
// Unlike Facebook there's no server-side webhook to unsubscribe: Google's
// Lead Form webhook is configured manually inside the Ads UI, so the
// advertiser has to remove the webhook URL from the Lead form asset
// themselves if they want deliveries to actually stop. webhookKey is kept
// (not wiped) so reconnecting later doesn't silently invalidate a webhook
// URL/key the advertiser already pasted in. Leads already saved are never
// touched.
const disconnectConnection = async (req, res) => {
  const conn = await findConnection();
  if (!conn) {
    return res.status(200).json({ success: true, result: sanitizeConnection(null), message: 'Already disconnected' });
  }

  conn.status = 'disconnected';
  conn.refreshToken = undefined;
  conn.accessToken = undefined;
  conn.tokenExpiresAt = undefined;
  conn.updated = Date.now();
  await conn.save();

  return res.status(200).json({ success: true, result: sanitizeConnection(conn), message: 'Google Ads disconnected' });
};

module.exports = { getConnection, updateConnection, disconnectConnection };
