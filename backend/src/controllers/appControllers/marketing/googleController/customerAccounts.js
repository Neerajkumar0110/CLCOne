const graph = require('../../../../utils/googleAdsClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/customer-accounts — real Google Ads accounts fetched right
// now, never hard-coded: the ones the active login reaches directly AND the
// client accounts under any manager (MCC) account it reaches
// (googleAdsClient.listAdAccounts). Each row carries the loginCustomerId to
// save with it, so a client account under a manager works too.
const getCustomerAccounts = async (req, res) => {
  const conn = await requireConnection(res);
  if (!conn) return;

  try {
    const accessToken = await getFreshAccessToken(conn);
    const accounts = await graph.listAdAccounts(accessToken);
    accounts.sort((a, b) => Number(a.manager) - Number(b.manager) || String(a.name).localeCompare(String(b.name)));

    return res.status(200).json({
      success: true,
      result: accounts.map((a) => ({
        id: a.customerId,
        name: a.name || a.customerId,
        currency: a.currency,
        status: a.status,
        manager: a.manager,
        managerName: a.managerName,
        loginCustomerId: a.loginCustomerId,
        error: a.error,
      })),
      message: 'Successfully fetched Google Ads accounts',
    });
  } catch (err) {
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = getCustomerAccounts;
