const graph = require('../../../utils/metaGraphClient');
const { requireConnection, decryptedUserToken } = require('./_helpers');

// GET /api/facebook/pages — real Pages fetched from Meta right now, never
// hard-coded. Only id/name/category go to the frontend; each page's own
// access token (bundled in Meta's response) never leaves the server.
const getPages = async (req, res) => {
  const conn = await requireConnection(res);
  if (!conn) return;

  try {
    const pages = await graph.getPages(decryptedUserToken(conn));
    return res.status(200).json({
      success: true,
      result: pages.map((p) => ({ id: p.id, name: p.name, category: p.category })),
      message: 'Successfully fetched Facebook Pages',
    });
  } catch (err) {
    return res.status(502).json({ success: false, result: null, message: err.message });
  }
};

module.exports = getPages;
