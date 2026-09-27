const mongoose = require('mongoose');

const Model = mongoose.model('SalesDeal');

// Same shape as the generic createCRUDController#create, except `owner`
// defaults to the creating user's name when the client doesn't send one —
// previously `owner` was a plain free-text field nothing ever stamped, so a
// deal created without explicitly typing an owner had no reliable way to
// know whose data it was (and the new row-level visibility scoping — see
// scope.js — depends on this field being populated).
const create = async (req, res) => {
  const b = req.body || {};
  b.removed = false;
  if (!b.owner) b.owner = req.admin.name;

  const result = await new Model(b).save();
  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully Created the document in Model ',
  });
};

module.exports = create;
