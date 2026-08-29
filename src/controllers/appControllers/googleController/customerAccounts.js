const graph = require('@/utils/googleAdsClient');
const { requireConnection, getFreshAccessToken } = require('./_helpers');

// GET /api/google/customer-accounts — real Google Ads accounts fetched right
// now, never hard-coded. listAccessibleCustomers only returns bare ids, so
// each one is enriched with a GAQL lookup for its descriptive name/currency/
// status (see utils/googleAdsClient.getCustomerInfo).
const getCustomerAccounts = async (req, res) => {
  const conn = await requireConnection(res);
  if (!conn) return;

  try {
    const accessToken = await getFreshAccessToken(conn);
    const customerIds = await graph.listAccessibleCustomers(accessToken);

    const accounts = await Promise.all(
      customerIds.map((customerId) =>
        graph
          .getCustomerInfo({ customerId, accessToken, loginCustomerId: conn.loginCustomerId })
          .catch((err) => ({ customerId, error: err.message }))
      )
    );

    return res.status(200).json({
      success: true,
      result: accounts.map((a) => ({
        id: a.customerId,
        name: a.descriptiveName || a.customerId,
        currency: a.currencyCode,
        status: a.status,
        error: a.error,
      })),
      message: 'Successfully fetched Google Ads accounts',
    });
  } catch (err) {
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = getCustomerAccounts;
