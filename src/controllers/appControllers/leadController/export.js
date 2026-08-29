const mongoose = require('mongoose');
const XLSX = require('xlsx');

const EXPORT_COLUMNS = ['name', 'phone', 'source', 'team', 'position', 'status'];

// GET /api/lead/export?format=csv|excel&team=<optional filter>
// Streams a CSV or .xlsx file of all (non-removed) leads, or just one team's.
const exportLeads = async (req, res) => {
  const Lead = mongoose.model('Lead');

  const format = (req.query.format || 'csv').toLowerCase();
  const filter = { removed: false };
  if (req.query.team) filter.team = req.query.team;

  const leads = await Lead.find(filter).sort({ created: 'desc' }).exec();

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
