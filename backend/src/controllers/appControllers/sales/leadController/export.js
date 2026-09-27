const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { leadScopeFilter } = require('./scope');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');

const EXPORT_COLUMNS = [
  'name',
  'phone',
  'email',
  'source',
  'team',
  'position',
  'stage',
  'subStatus',
  'assignedUserName',
  'callBackAt',
  'nextFollowUpAt',
  'status',
];

// GET /api/lead/export?format=csv|excel&team=<optional filter>
// Streams a CSV or .xlsx file of all (non-removed) leads, or just one team's.
const exportLeads = async (req, res) => {
  // Import/Export is management tooling, not just a scoped read — same tier
  // as the "Import / Export" tab's frontend gate (pages/Leads/index.jsx).
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({
      success: false,
      result: null,
      message: 'Export is only available to Owner, Super Admin, Admin, Sales Manager and Team Manager.',
    });
  }

  const Lead = mongoose.model('Lead');

  const format = (req.query.format || 'csv').toLowerCase();
  const filter = { removed: false };
  if (req.query.team) filter.team = req.query.team;

  // Row-level visibility — same rule as every other Lead read path (see
  // scope.js). Kept even though this endpoint is now full-access-only, so
  // it degrades safely if that gate is ever loosened.
  const scopeFilter = await leadScopeFilter(req.admin, req);
  const query = Object.keys(scopeFilter).length ? { $and: [filter, scopeFilter] } : filter;

  const leads = await Lead.find(query).sort({ created: 'desc' }).exec();

  const rows = leads.map((l) => {
    const row = {};
    EXPORT_COLUMNS.forEach((c) => {
      row[c] = l[c] || '';
    });
    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, { header: EXPORT_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');

  if (format === 'excel' || format === 'xlsx') {
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leads-export.xlsx"');
    return res.send(buffer);
  }

  const csv = XLSX.utils.sheet_to_csv(worksheet);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads-export.csv"');
  return res.send(csv);
};

module.exports = exportLeads;
