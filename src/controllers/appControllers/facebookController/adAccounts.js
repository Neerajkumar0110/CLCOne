const graph = require('@/utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/ad-accounts — real Ad Accounts fetched from Meta right
// now, never hard-coded.
const getAdAccounts = async (req, res) => {
  const conn = await requireConnection(res);
  if (!conn) return;

  try {
    const accounts = await graph.getAdAccounts(decryptedUserToken(conn));
    return res.status(200).json({
      success: true,
      result: accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status })),
      message: 'Successfully fetched Ad Accounts',
    });
  } catch (err) {
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = getAdAccounts;
