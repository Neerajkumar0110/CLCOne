const client = require('@/utils/linkedinAdsClient');
const { requireConnection, decryptedAccessToken } = require('./_helpers');

// GET /api/linkedin/ad-accounts — real Ad Accounts fetched from LinkedIn
// right now, never hard-coded. Mirrors facebookController/adAccounts.js.
const getAdAccounts = async (req, res) => {
  const conn = await requireConnection(res);
  if (!conn) return;

  try {
    const accounts = await client.getAdAccounts(decryptedAccessToken(conn));
    return res.status(200).json({
      success: true,
      result: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        currency: a.currency,
        status: a.status,
      })),
      message: 'Successfully fetched LinkedIn Ad Accounts',
    });
  } catch (err) {
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = getAdAccounts;
