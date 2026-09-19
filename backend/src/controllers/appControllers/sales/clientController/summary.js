const mongoose = require('mongoose');
const moment = require('moment');

const InvoiceModel = mongoose.model('Invoice');

const summary = async (Model, req, res) => {
  let defaultType = 'month';
  const { type } = req.query;

  if (type && ['week', 'month', 'year'].includes(type)) {
    defaultType = type;
  } else if (type) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'Invalid type',
    });
  }

  const currentDate = moment();
  let startDate = currentDate.clone().startOf(defaultType);
  let endDate = currentDate.clone().endOf(defaultType);

  // Client (salesDb) and Invoice (financeDb) are separate physical
  // databases now — Mongo's $lookup can't join across them even within the
  // same cluster, so "active clients" (clients with >=1 non-removed
  // invoice) is computed as two separate queries + a JS count instead of
  // one $facet branch. totalClients/newClients stay a single aggregate
  // since they only ever touch Client.
  const pipeline = [
    {
      $facet: {
        totalClients: [
          {
            $match: {
              removed: false,
              enabled: true,
            },
          },
          {
            $count: 'count',
          },
        ],
        newClients: [
          {
            $match: {
              removed: false,
              created: { $gte: startDate.toDate(), $lte: endDate.toDate() },
              enabled: true,
            },
          },
          {
            $count: 'count',
          },
        ],
      },
    },
  ];

  const allClientIds = (await Model.find({}, '_id').lean()).map((c) => c._id);
  const [aggregationResult, activeClientIds] = await Promise.all([
    Model.aggregate(pipeline),
    InvoiceModel.distinct('client', { removed: false, client: { $in: allClientIds } }),
  ]);

  const result = aggregationResult[0];
  const totalClients = result.totalClients[0] ? result.totalClients[0].count : 0;
  const totalNewClients = result.newClients[0] ? result.newClients[0].count : 0;
  const activeClients = activeClientIds.length;

  const totalActiveClientsPercentage = totalClients > 0 ? (activeClients / totalClients) * 100 : 0;
  const totalNewClientsPercentage = totalClients > 0 ? (totalNewClients / totalClients) * 100 : 0;

  return res.status(200).json({
    success: true,
    result: {
      new: Math.round(totalNewClientsPercentage),
      active: Math.round(totalActiveClientsPercentage),
    },
    message: 'Successfully get summary of new clients',
  });
};

module.exports = summary;
