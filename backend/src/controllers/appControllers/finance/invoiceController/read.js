const mongoose = require('mongoose');
const { hydrateClientAndAdmin } = require('../../../../services/finance/hydrateClientAndAdmin');

const Model = mongoose.model('Invoice');

const read = async (req, res) => {
  // Find document by id
  const result = await Model.findOne({
    _id: req.params.id,
    removed: false,
  }).exec();
  // If no results found, return document not found
  if (!result) {
    return res.status(404).json({
      success: false,
      result: null,
      message: 'No document found ',
    });
  } else {
    // createdBy (Admin, coreDb) and client (Client, salesDb) are plain refs
    // now — Invoice is financeDb, so autopopulate/.populate() can't cross
    // databases. Hydrate both manually so response shape is unchanged.
    const hydratedResult = await hydrateClientAndAdmin(result, { adminSelect: 'name' });
    // Return success resposne
    return res.status(200).json({
      success: true,
      result: hydratedResult,
      message: 'we found this document ',
    });
  }
};

module.exports = read;
