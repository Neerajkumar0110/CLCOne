const mongoose = require('mongoose');
const { notify } = require('@/notify');

const Model = mongoose.model('Lead');

// Same write as the generic createCRUDController/create.js — the only
// addition is a notification to the lead's team once it's saved. Only
// covers manual creation from the UI (this is the /lead/create route);
// bulk import (leadController/import.js) and the Facebook/Google/LinkedIn
// webhook capture paths write Lead docs directly and deliberately skip
// this, since notifying on every row of a 200-lead import would be noise,
// not signal.
const create = async (req, res) => {
  req.body.removed = false;
  const result = await new Model({ ...req.body }).save();

  notify({
    audience: 'team',
    teamName: result.team,
    actorId: req.admin._id,
    actorName: req.admin.name,
    module: 'Leads',
    type: 'lead.created',
    title: `New lead: ${result.name}`,
    body: result.source ? `via ${result.source}` : undefined,
    link: '/leads',
  });

  return res.status(200).json({
    success: true,
    result,
    message: 'Successfully Created the document in Model ',
  });
};

module.exports = create;
